-- Le point de départ est fixé au déploiement, pas au début de l’historique importé.
alter table public.qonto_connections add column auto_intake boolean not null default true;
alter table public.qonto_connections add column auto_intake_from timestamptz not null default now();

create table public.bank_transaction_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  bank_transaction_id uuid not null unique references public.bank_transactions(id),
  side text not null check(side in ('credit','debit')),
  status text not null default 'pending' check(status in ('pending','dismissed','processed')),
  payload jsonb not null default '{}',
  intervention_id uuid references public.interventions(id), expense_id uuid references public.expenses(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  processed_by uuid references public.profiles(id)
);
create index bank_drafts_inbox on public.bank_transaction_drafts(organization_id,side,status,created_at desc);
alter table public.bank_transaction_drafts enable row level security;
create policy bank_drafts_managers_read on public.bank_transaction_drafts for select to authenticated
  using(public.has_permission(organization_id,'business.manage'));
revoke all on public.bank_transaction_drafts from anon,authenticated;
grant select on public.bank_transaction_drafts to authenticated;
grant all on public.bank_transaction_drafts to service_role;

create function public.prepare_qonto_drafts(target_org uuid) returns integer language plpgsql security definer set search_path=public as $$
declare quantity integer;
begin
  insert into public.bank_transaction_drafts(organization_id,bank_transaction_id,side,payload)
    select tx.organization_id,tx.id,tx.side,jsonb_build_object(
      'title',left(coalesce(nullif(tx.label,''),nullif(tx.counterparty,''),'Prestation à préciser'),160),
      'performedOn',(tx.settled_at at time zone 'Europe/Paris')::date::text,
      'expenseDate',(tx.settled_at at time zone 'Europe/Paris')::date::text,
      'completed',true,'revenue',tx.amount_cents,'durationMinutes',0,
      'supplier',left(tx.counterparty,300),'category','','family','variable','vatRateBasisPoints',0,'vatRecoverable',false,'notes','')
    from public.bank_transactions tx join public.qonto_connections c on c.organization_id=tx.organization_id
    where tx.organization_id=target_org and c.enabled and c.auto_intake and tx.settled_at>=c.auto_intake_from
      and tx.status='completed' and tx.currency='EUR' and tx.amount_cents>0 and tx.settled_at<=now()
      and tx.operation_type<>'internal_transfer' and tx.reconciliation='unmatched' and tx.reconciliation_group_id is null
    on conflict(bank_transaction_id) do nothing;
  get diagnostics quantity=row_count;
  return quantity;
end $$;
revoke all on function public.prepare_qonto_drafts(uuid) from public,anon,authenticated;
grant execute on function public.prepare_qonto_drafts(uuid) to service_role;

-- Un rapprochement manuel, historique ou automatique ferme aussi sa proposition.
create function public.close_processed_bank_draft() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.reconciliation in ('matched','ignored') then
    update public.bank_transaction_drafts set status='processed',updated_at=now(),processed_by=auth.uid()
      where bank_transaction_id=new.id and status in ('pending','dismissed');
  end if;
  return new;
end $$;
create trigger bank_transactions_close_draft after update on public.bank_transactions for each row execute function public.close_processed_bank_draft();

create function public.manage_bank_draft(target_draft uuid,action text,details jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
<<draft_action>>
declare
  draft public.bank_transaction_drafts%rowtype; tx public.bank_transactions%rowtype;
  payload jsonb; target_kind text; target_id uuid; target_month date; client_id uuid;
  owner_location uuid; result_job uuid; result_expense uuid; result_payment uuid;
  title text; job_date date; duration integer; revenue bigint; vat integer; net bigint;
  worker public.organization_members%rowtype; completed boolean;
begin
  select * into draft from public.bank_transaction_drafts where id=target_draft;
  if not found or not coalesce(public.has_permission(draft.organization_id,'business.manage'),false) then
    raise exception 'Proposition introuvable ou accès réservé aux associés.';
  end if;
  -- Même ordre que les synchronisations et rapprochements : banque, puis brouillon.
  select * into tx from public.bank_transactions where id=draft.bank_transaction_id for update;
  select * into draft from public.bank_transaction_drafts where id=target_draft for update;
  if action='validate' and draft.status='processed' then
    return jsonb_build_object('interventionId',draft.intervention_id,'expenseId',draft.expense_id,'alreadyProcessed',true);
  end if;
  if (details->>'expectedUpdatedAt')::timestamptz is distinct from draft.updated_at then
    raise exception 'Cette proposition a été modifiée entre-temps. Rechargez-la avant de continuer.';
  end if;
  if action='dismiss' then
    if draft.status<>'pending' then raise exception 'Cette proposition n’est plus en attente.'; end if;
    update public.bank_transaction_drafts set status='dismissed',updated_at=now(),processed_by=auth.uid() where id=draft.id;
    return jsonb_build_object('ok',true);
  end if;
  if action='restore' then
    if draft.status<>'dismissed' or tx.reconciliation<>'unmatched' then raise exception 'Seule une proposition supprimée et non rapprochée peut être restaurée.'; end if;
    update public.bank_transaction_drafts set status='pending',updated_at=now(),processed_by=auth.uid() where id=draft.id;
    return jsonb_build_object('ok',true);
  end if;
  if draft.status<>'pending' then raise exception 'Cette proposition n’est plus en attente.'; end if;
  payload:=coalesce(details->'payload',draft.payload);
  if jsonb_typeof(payload)<>'object' then raise exception 'Brouillon invalide.'; end if;
  if action='save' then
    update public.bank_transaction_drafts set payload=draft_action.payload,updated_at=now() where id=draft.id;
    return jsonb_build_object('ok',true);
  end if;
  if action<>'validate' or action is null then raise exception 'Action inconnue.'; end if;
  if tx.reconciliation<>'unmatched' or tx.reconciliation_group_id is not null or tx.status<>'completed' or tx.currency<>'EUR'
    or tx.operation_type='internal_transfer' or tx.settled_at is null or tx.settled_at>now() or tx.amount_cents<=0 then
    raise exception 'Cette opération bancaire a changé ou a déjà été traitée. Rechargez la liste.';
  end if;
  if (details->>'expectedAmount')::bigint is distinct from tx.amount_cents
    or (details->>'expectedSettledAt')::timestamptz is distinct from tx.settled_at then
    raise exception 'Le montant ou la date bancaire a changé. Rechargez avant de valider.';
  end if;
  target_kind:=details->>'targetKind';
  target_id:=nullif(details->>'targetId','')::uuid;
  target_month:=nullif(details->>'month','')::date;
  if target_kind in ('payment','expense','intervention','invoice','maintenance') then
    perform public.reconcile_bank_transaction(tx.id,target_kind,target_id,target_month);
    select payment_id,expense_id into result_payment,result_expense from public.bank_transactions where id=tx.id;
    if result_payment is not null then select intervention_id into result_job from public.payments where id=result_payment; end if;
  elsif target_kind='new' then
    select location_id into owner_location from public.qonto_connections where organization_id=tx.organization_id;
    title:=trim(coalesce(payload->>'title',''));
    if length(title)<2 or length(title)>160 then raise exception 'Renseignez un intitulé de 2 à 160 caractères.'; end if;
    if tx.side='credit' then
      client_id:=nullif(payload->>'clientId','')::uuid;
      if not exists(select 1 from public.clients c where c.id=draft_action.client_id and c.organization_id=tx.organization_id and c.archived_at is null) then
        raise exception 'Sélectionnez un client existant, ou créez sa fiche avant de valider.';
      end if;
      revenue:=coalesce((payload->>'revenue')::bigint,tx.amount_cents);
      duration:=coalesce((payload->>'durationMinutes')::integer,0);
      completed:=coalesce((payload->>'completed')::boolean,true);
      job_date:=nullif(payload->>'performedOn','')::date;
      if revenue<tx.amount_cents or duration<0 or duration>1440 then raise exception 'Le prix doit couvrir l’encaissement ; la durée doit être comprise entre 0 et 1440 minutes.'; end if;
      if completed and (job_date is null or job_date>(now() at time zone 'Europe/Paris')::date) then raise exception 'Indiquez la date passée de la prestation effectuée.'; end if;
      -- Un paiement saisi entre la préparation et la validation ne doit pas être doublé.
      if not coalesce((details->>'confirmNew')::boolean,false) and exists(
        select 1 from public.payments p
        left join public.interventions j on j.id=p.intervention_id
        left join public.invoices i on i.id=p.invoice_id
        left join public.maintenance_contracts mc on mc.id=p.maintenance_contract_id
        where p.organization_id=tx.organization_id and coalesce(j.client_id,i.client_id,mc.client_id)=draft_action.client_id
          and p.amount_cents=tx.amount_cents and abs(extract(epoch from p.paid_at-tx.settled_at))<=7*86400
      ) then raise exception 'Un paiement semblable existe déjà pour ce client. Rapprochez-le ou confirmez explicitement une nouvelle prestation.'; end if;
      if nullif(payload->>'workerId','') is not null then
        select * into worker from public.organization_members m where m.organization_id=tx.organization_id and m.active
          and (m.id=(payload->>'workerId')::uuid or m.profile_id=(payload->>'workerId')::uuid);
        if not found then raise exception 'Collaborateur indisponible dans cette entreprise.'; end if;
      end if;
      insert into public.interventions(organization_id,location_id,client_id,title,status,start_at,end_at,planned_duration_minutes,actual_duration_minutes,notes,created_by)
        values(tx.organization_id,owner_location,client_id,title,case when completed then 'completed'::public.intervention_status when job_date is null then 'to_schedule'::public.intervention_status else 'scheduled'::public.intervention_status end,
          (job_date+time '12:00') at time zone 'Europe/Paris',case when duration>0 then ((job_date+time '12:00') at time zone 'Europe/Paris')+make_interval(mins=>duration) end,
          duration,case when completed then duration end,left(coalesce(payload->>'notes',''),5000),auth.uid()) returning id into result_job;
      insert into public.intervention_items(organization_id,intervention_id,label,quantity,revenue_allocated_cents)
        values(tx.organization_id,result_job,title,1,revenue);
      if worker.id is not null then
        insert into public.intervention_workers(organization_id,intervention_id,profile_id,pending_member_id,planned_minutes,actual_minutes)
          values(tx.organization_id,result_job,worker.profile_id,case when worker.profile_id is null then worker.id end,duration,case when completed then duration end);
      end if;
      insert into public.payments(organization_id,location_id,intervention_id,amount_cents,paid_at,method,reference,created_by)
        values(tx.organization_id,owner_location,result_job,tx.amount_cents,tx.settled_at,'Virement Qonto',tx.remote_id,auth.uid()) returning id into result_payment;
      update public.bank_transactions set payment_id=result_payment,reconciliation='matched',created_entry=true,reconciled_at=now(),reconciled_by=auth.uid() where id=tx.id;
    else
      if length(trim(coalesce(payload->>'category','')))<2 then raise exception 'Renseignez une catégorie de charge.'; end if;
      if not coalesce((details->>'confirmNew')::boolean,false) and exists(select 1 from public.expenses e where e.organization_id=tx.organization_id and e.archived_at is null
        and e.amount_including_tax_cents=tx.amount_cents and (e.recurrence<>'one_off' or abs(e.expense_date-(tx.settled_at at time zone 'Europe/Paris')::date)<=10)
        and ((length(trim(coalesce(payload->>'supplier','')))>3 and lower(trim(e.supplier))=lower(trim(payload->>'supplier'))) or lower(e.description)=lower(title))) then
        raise exception 'Une charge semblable existe déjà. Rapprochez-la ou confirmez explicitement une nouvelle charge.';
      end if;
      vat:=coalesce((payload->>'vatRateBasisPoints')::integer,0);
      if vat<0 or vat>10000 then raise exception 'Taux de TVA invalide.'; end if;
      net:=round(tx.amount_cents::numeric/(1+vat::numeric/10000));
      insert into public.expenses(organization_id,location_id,expense_date,family,category,supplier,description,amount_including_tax_cents,amount_excluding_tax_cents,vat_rate_basis_points,vat_amount_cents,vat_recoverable,recurrence,allocated_month,paid,created_by)
        values(tx.organization_id,owner_location,(payload->>'expenseDate')::date,coalesce(payload->>'family','variable'),left(trim(payload->>'category'),120),left(coalesce(payload->>'supplier',tx.counterparty),300),title,
          tx.amount_cents,net,vat,tx.amount_cents-net,coalesce((payload->>'vatRecoverable')::boolean,false) and coalesce(payload->>'family','variable')<>'personal','one_off',date_trunc('month',(payload->>'expenseDate')::date)::date,false,auth.uid()) returning id into result_expense;
      perform public.reconcile_bank_transaction(tx.id,'expense',result_expense,date_trunc('month',(payload->>'expenseDate')::date)::date);
    end if;
  else raise exception 'Choisissez une nouvelle saisie ou un enregistrement existant.';
  end if;
  update public.bank_transaction_drafts set status='processed',payload=draft_action.payload,intervention_id=result_job,expense_id=result_expense,processed_by=auth.uid(),updated_at=now() where id=draft.id;
  return jsonb_build_object('interventionId',result_job,'expenseId',result_expense);
end $$;
revoke all on function public.manage_bank_draft(uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.manage_bank_draft(uuid,text,jsonb) to authenticated;

-- L’archivage doit échouer AVANT de retirer une prestation financée par Qonto.
create function public.protect_bank_funded_intervention() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.archived_at is distinct from old.archived_at and exists(
    select 1 from public.payments p where p.intervention_id=old.id and
      (exists(select 1 from public.bank_transactions b where b.payment_id=p.id) or exists(select 1 from public.bank_reconciliation_groups g where g.payment_id=p.id))
  ) then raise exception 'Annulez le rapprochement Qonto dans Banque avant de supprimer cette prestation.'; end if;
  return new;
end $$;
create trigger interventions_protect_bank_payment before update on public.interventions for each row execute function public.protect_bank_funded_intervention();
