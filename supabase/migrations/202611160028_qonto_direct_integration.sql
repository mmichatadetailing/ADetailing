-- Automatisation prospective : l’historique et les brouillons déjà travaillés restent intacts.
alter table public.qonto_connections add column auto_create boolean not null default true;
alter table public.qonto_connections add column auto_create_from timestamptz not null default now();
alter table public.bank_transactions add column automation_note text;
alter table public.bank_transactions add column automated_at timestamptz;

create function public.qonto_identity(value text) returns text language sql immutable set search_path=public as $$
  select trim(regexp_replace(regexp_replace(normalize(lower(coalesce(value,'')), NFD), U&'[\0300-\036f]', '', 'g'), '[^a-z0-9+]+', ' ', 'g'))
$$;

-- Une transaction SQL par mouvement : création, règlement et traçabilité sont atomiques.
-- Le navigateur n’a jamais accès à cette porte d’écriture.
create function public.automate_qonto_transaction(target_transaction uuid, expected_amount bigint, expected_settled_at timestamptz, decision jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
<<automatic>>
declare
  tx public.bank_transactions%rowtype;
  connection public.qonto_connections%rowtype;
  draft public.bank_transaction_drafts%rowtype;
  customer uuid; customer_name text; customer_ids uuid[];
  job_id uuid; payment_id uuid; expense_id uuid; title text; category text;
  action text:=decision->>'action'; note text; result_kind text;
begin
  select * into tx from public.bank_transactions where id=target_transaction for update;
  if not found then raise exception 'Transaction introuvable.'; end if;
  -- Sérialise aussi les créations de clients entre plusieurs mouvements d’une entreprise.
  select * into connection from public.qonto_connections where organization_id=tx.organization_id for update;
  if not found or not connection.enabled or not connection.auto_intake or not connection.auto_create
    or tx.settled_at<greatest(connection.auto_intake_from,connection.auto_create_from) then
    return jsonb_build_object('skipped',true);
  end if;
  if tx.reconciliation<>'unmatched' or tx.reconciliation_group_id is not null or tx.automated_at is not null then return jsonb_build_object('skipped',true); end if;
  if tx.amount_cents is distinct from expected_amount or tx.settled_at is distinct from expected_settled_at then
    raise exception 'La transaction bancaire a changé. Nouvelle tentative à la prochaine synchronisation.';
  end if;
  if tx.status<>'completed' or tx.currency<>'EUR' or tx.amount_cents<=0 or tx.settled_at is null or tx.settled_at>now() then
    return jsonb_build_object('skipped',true);
  end if;
  select * into draft from public.bank_transaction_drafts where bank_transaction_id=tx.id for update;
  if found and (draft.status<>'pending' or draft.updated_at<>draft.created_at) then return jsonb_build_object('skipped',true); end if;
  if action='review' then
    update public.bank_transactions set automation_note=left(decision->>'reason',500) where id=tx.id;
    return jsonb_build_object('review',true);
  end if;
  if action='ignore' then
    if tx.operation_type<>'internal_transfer' then raise exception 'Seuls les virements internes identifiés peuvent être exclus automatiquement.'; end if;
    perform public.reconcile_bank_transaction(tx.id,'ignore',null,null,jsonb_build_object('reason','Virement entre comptes Qonto de l’entreprise'));
    result_kind:='ignored'; note:='Virement interne exclu automatiquement des statistiques.';
  elsif action='match' then
    if decision->>'kind' not in ('payment','expense','intervention','invoice','maintenance') then raise exception 'Cible automatique invalide.'; end if;
    perform public.reconcile_bank_transaction(tx.id,decision->>'kind',(decision->>'id')::uuid,nullif(decision->>'month','')::date);
    select b.payment_id,b.expense_id into payment_id,expense_id from public.bank_transactions b where b.id=tx.id;
    if payment_id is not null then select p.intervention_id into job_id from public.payments p where p.id=automatic.payment_id; end if;
    result_kind:='matched'; note:='Rapproché automatiquement avec une écriture existante.';
  elsif action='expense' and tx.side='debit' and tx.operation_type<>'internal_transfer' then
    title:=left(coalesce(nullif(trim(tx.label),''),nullif(trim(tx.counterparty),''),'Dépense Qonto'),160);
    -- Un abonnement au montant modifié ou une saisie récente ne doit pas être recréé.
    if exists(select 1 from public.expenses e where e.organization_id=tx.organization_id and e.archived_at is null
      and ((length(public.qonto_identity(tx.counterparty))>=3 and public.qonto_identity(e.supplier)=public.qonto_identity(tx.counterparty)) or public.qonto_identity(e.description)=public.qonto_identity(title))
      and ((e.recurrence<>'one_off' and (e.ends_on is null or e.ends_on>=(tx.settled_at at time zone 'Europe/Paris')::date))
        or (e.amount_including_tax_cents=tx.amount_cents and abs(e.expense_date-(tx.settled_at at time zone 'Europe/Paris')::date)<=10))) then
      update public.bank_transactions set automation_note='Une charge ou un abonnement similaire existe déjà : vérifiez son échéance avant de créer une nouvelle charge.' where id=tx.id;
      return jsonb_build_object('review',true);
    end if;
    -- Réutilise uniquement une catégorie non ambiguë ; jamais une TVA supposée.
    select case when count(distinct e.category)=1 then min(e.category) end into category from public.expenses e
      where e.organization_id=tx.organization_id and e.archived_at is null and e.family<>'personal'
        and length(public.qonto_identity(tx.counterparty))>=3 and public.qonto_identity(e.supplier)=public.qonto_identity(tx.counterparty);
    category:=coalesce(nullif(category,''),'Achats Qonto');
    perform public.reconcile_bank_transaction(tx.id,'new_expense',null,null,jsonb_build_object('description',title,'category',category));
    select b.expense_id into expense_id from public.bank_transactions b where b.id=tx.id;
    result_kind:='expense'; note:='Charge créée et réglée automatiquement. TVA non déduite ; catégorie modifiable.';
  elsif action='service' and tx.side='credit' and tx.operation_type<>'internal_transfer' then
    customer:=nullif(decision->>'clientId','')::uuid;
    customer_name:=left(trim(coalesce(decision->>'clientName','')),300);
    if customer is null then
      if length(public.qonto_identity(customer_name))<3 or public.qonto_identity(customer_name)<>public.qonto_identity(tx.counterparty) then raise exception 'Nom bancaire du client requis.'; end if;
      select array_agg(c.id) into customer_ids from public.clients c where c.organization_id=tx.organization_id and c.archived_at is null
        and public.qonto_identity(customer_name) in (public.qonto_identity(c.company),public.qonto_identity(c.first_name||' '||c.last_name),public.qonto_identity(c.last_name||' '||c.first_name));
      if cardinality(customer_ids)>1 then
        update public.bank_transactions set automation_note='Plusieurs fiches clients portent ce nom bancaire.' where id=tx.id;
        return jsonb_build_object('review',true);
      end if;
      customer:=customer_ids[1];
    end if;
    if customer is not null then
      perform 1 from public.clients c where c.id=customer and c.organization_id=tx.organization_id and c.archived_at is null for update;
      if not found then raise exception 'Client indisponible dans cette entreprise.'; end if;
      if exists(select 1 from public.interventions j where j.organization_id=tx.organization_id and j.client_id=customer and j.archived_at is null and j.status<>'cancelled'
        and (j.status<>'completed' or abs(extract(epoch from j.start_at-tx.settled_at))<=7*86400))
        or exists(select 1 from public.maintenance_contracts mc where mc.organization_id=tx.organization_id and mc.client_id=customer and mc.archived_at is null)
        or exists(select 1 from public.invoices i where i.organization_id=tx.organization_id and i.client_id=customer and i.archived_at is null and i.status not in ('cancelled','credit_note','paid')) then
        update public.bank_transactions set automation_note='Un dossier de ce client existe déjà : affectation du règlement à vérifier.' where id=tx.id;
        return jsonb_build_object('review',true);
      end if;
    else
      insert into public.clients(organization_id,location_id,kind,first_name,last_name,notes)
        values(tx.organization_id,connection.location_id,'individual','',customer_name,'Fiche créée depuis le nom bancaire Qonto. Identité et coordonnées à compléter si nécessaire.') returning id into customer;
    end if;
    title:=left(coalesce(nullif(trim(tx.label),''),'Prestation · '||customer_name),160);
    if length(title)<2 then title:='Prestation Qonto'; end if;
    -- Choix métier : les nouvelles prestations encaissées sont considérées terminées.
    -- La date de réalisation reprend la date bancaire ; aucune durée n’est inventée.
    insert into public.interventions(organization_id,location_id,client_id,title,status,start_at,planned_duration_minutes,notes)
      values(tx.organization_id,connection.location_id,customer,title,'completed',tx.settled_at,0,'Créée automatiquement depuis Qonto comme prestation terminée. Date de réalisation initialisée sur celle de l’encaissement ; contenu, date et durée restent modifiables.') returning id into job_id;
    insert into public.intervention_items(organization_id,intervention_id,label,quantity,revenue_allocated_cents)
      values(tx.organization_id,job_id,title,1,tx.amount_cents);
    insert into public.payments(organization_id,location_id,intervention_id,amount_cents,paid_at,method,reference)
      values(tx.organization_id,connection.location_id,job_id,tx.amount_cents,tx.settled_at,'Virement Qonto',tx.remote_id) returning id into payment_id;
    update public.bank_transactions set payment_id=automatic.payment_id,reconciliation='matched',created_entry=true,reconciled_at=now() where id=tx.id;
    result_kind:='service'; note:='Prestation terminée et encaissement créés automatiquement à la date bancaire, sans durée supposée.';
  else raise exception 'Décision automatique incompatible avec le mouvement.';
  end if;
  update public.bank_transactions set automated_at=now(),automation_note=note where id=tx.id;
  update public.bank_transaction_drafts set status='processed',intervention_id=job_id,expense_id=automatic.expense_id,updated_at=now() where bank_transaction_id=tx.id;
  return jsonb_build_object('kind',result_kind,'interventionId',job_id,'expenseId',expense_id);
end $$;
revoke all on function public.automate_qonto_transaction(uuid,bigint,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.automate_qonto_transaction(uuid,bigint,timestamptz,jsonb) to service_role;
