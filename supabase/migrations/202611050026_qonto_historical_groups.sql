-- Plusieurs mouvements bancaires peuvent justifier UNE écriture historique.
-- Ce mode est exclusivement manuel : il conserve les montants/dates déjà saisis.
create table public.bank_reconciliation_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  payment_id uuid unique references public.payments(id),
  expense_id uuid references public.expenses(id), expense_month date,
  amount_cents bigint not null check(amount_cents>0),
  note text not null default '', created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  check(num_nonnulls(payment_id,expense_id)=1),
  check((expense_id is null)=(expense_month is null)),
  unique(expense_id,expense_month)
);
alter table public.bank_reconciliation_groups enable row level security;
create policy bank_groups_managers_read on public.bank_reconciliation_groups for select to authenticated
  using(public.has_permission(organization_id,'business.manage'));
revoke all on public.bank_reconciliation_groups from anon,authenticated;
grant select on public.bank_reconciliation_groups to authenticated;
grant all on public.bank_reconciliation_groups to service_role;
alter table public.bank_transactions add column reconciliation_group_id uuid references public.bank_reconciliation_groups(id);
alter table public.bank_transactions add constraint bank_group_has_no_single_target check
  (reconciliation_group_id is null or (payment_id is null and expense_id is null and not created_entry));
create index bank_transactions_group on public.bank_transactions(reconciliation_group_id) where reconciliation_group_id is not null;

create function public.reconcile_bank_group(transaction_ids uuid[],target_kind text,target_id uuid,target_month date default null,note text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare
  org uuid; direction text; total bigint; group_id uuid; existing_group public.bank_reconciliation_groups%rowtype;
  p public.payments%rowtype; e public.expenses%rowtype; month_date date; due_date date; historical_paid_at timestamptz;
  first_transaction uuid; quantity integer;
begin
  quantity:=cardinality(transaction_ids);
  if quantity is null or quantity<2 or quantity>50 or (select count(distinct id) from unnest(transaction_ids) id)<>quantity then
    raise exception 'Sélectionnez entre 2 et 50 transactions distinctes.';
  end if;
  -- Tous les chemins verrouillent les mouvements dans le même ordre.
  perform 1 from public.bank_transactions where id=any(transaction_ids) order by id for update;
  select organization_id,side,id into org,direction,first_transaction from public.bank_transactions where id=any(transaction_ids) order by id limit 1;
  if org is null or not coalesce(public.has_permission(org,'business.manage'),false) then
    raise exception 'Regroupement réservé aux associés et administrateurs.';
  end if;
  if (select count(*) from public.bank_transactions where id=any(transaction_ids) and organization_id=org)<>quantity then
    raise exception 'Transactions introuvables ou appartenant à une autre entreprise.';
  end if;
  if target_kind not in ('payment','expense') or target_kind is null then raise exception 'Choisissez un paiement existant ou une charge déjà payée.'; end if;
  month_date:=date_trunc('month',target_month)::date;
  -- Rejouer exactement la même validation est sans effet supplémentaire.
  select g.* into existing_group from public.bank_reconciliation_groups g
    join public.bank_transactions tx on tx.reconciliation_group_id=g.id where tx.id=first_transaction;
  if found then
    if (select count(*) from public.bank_transactions where reconciliation_group_id=existing_group.id)=quantity
      and (select count(*) from public.bank_transactions where id=any(transaction_ids) and reconciliation_group_id=existing_group.id)=quantity
      and ((target_kind='payment' and existing_group.payment_id=target_id) or
        (target_kind='expense' and existing_group.expense_id=target_id and existing_group.expense_month=month_date)) then return existing_group.id; end if;
    raise exception 'Une transaction appartient déjà à un rapprochement. Annulez-le d’abord.';
  end if;
  if exists(select 1 from public.bank_transactions where id=any(transaction_ids) and
    (side<>direction or currency<>'EUR' or status<>'completed' or settled_at is null or settled_at>now()
      or amount_cents<=0 or operation_type='internal_transfer' or reconciliation<>'unmatched' or reconciliation_group_id is not null)) then
    raise exception 'Les transactions doivent être disponibles, terminées, en euros et toutes dans le même sens.';
  end if;
  select sum(amount_cents) into total from public.bank_transactions where id=any(transaction_ids);
  if target_kind='payment' then
    select * into p from public.payments where id=target_id and organization_id=org for update;
    if not found or direction<>'credit' or p.amount_cents<>total or p.paid_at>now() then raise exception 'Le total doit correspondre exactement au paiement existant déjà encaissé.'; end if;
    if exists(select 1 from public.bank_transactions where payment_id=p.id) or exists(select 1 from public.bank_reconciliation_groups where payment_id=p.id) then
      raise exception 'Ce paiement est déjà rapproché.';
    end if;
    insert into public.bank_reconciliation_groups(organization_id,payment_id,amount_cents,note,created_by)
      values(org,p.id,total,left(coalesce(note,''),500),auth.uid()) returning id into group_id;
  else
    select * into e from public.expenses where id=target_id and organization_id=org and archived_at is null for update;
    if not found or direction<>'debit' or e.amount_including_tax_cents<>total then raise exception 'Le total doit correspondre exactement à la charge existante.'; end if;
    if not coalesce(e.paid,false) then raise exception 'Ce mode historique nécessite une charge déjà marquée payée.'; end if;
    if month_date is null or month_date<date_trunc('month',e.expense_date)::date
      or (e.recurrence='one_off' and month_date<>date_trunc('month',e.expense_date)::date)
      or (e.recurrence='annual' and extract(month from month_date)<>extract(month from e.expense_date)) then raise exception 'Cette charge n’a pas d’échéance sur ce mois.'; end if;
    due_date:=month_date+(least(extract(day from e.expense_date)::integer,extract(day from month_date+interval '1 month - 1 day')::integer)-1);
    if e.ends_on is not null and due_date>e.ends_on then raise exception 'Cet ancien tarif n’est plus applicable.'; end if;
    if e.series_id is not null then
      perform 1 from public.expenses where organization_id=org and series_id=e.series_id order by id for update;
      if exists(select 1 from public.expenses newer where newer.organization_id=org and newer.series_id=e.series_id and newer.archived_at is null
        and newer.expense_date>e.expense_date and date_trunc('month',newer.expense_date)::date<=month_date and (newer.ends_on is null or newer.ends_on>=month_date)) then
        raise exception 'Sélectionnez le tarif applicable à cette échéance.';
      end if;
    end if;
    if exists(select 1 from public.expense_settlements s join public.expenses other on other.id=s.expense_id where s.period_month=month_date
      and (s.expense_id=e.id or (e.series_id is not null and other.series_id=e.series_id and other.organization_id=org))) then
      raise exception 'Cette échéance de charge est déjà rapprochée.';
    end if;
    -- On conserve le jour historique, pas les dates des débits Qonto.
    historical_paid_at:=case when e.recurrence='one_off' then coalesce(e.paid_at, (e.expense_date::date+time '12:00') at time zone 'Europe/Paris')
      else (due_date+time '12:00') at time zone 'Europe/Paris' end;
    if historical_paid_at>now() then raise exception 'Le regroupement historique ne concerne que des charges déjà payées.'; end if;
    insert into public.bank_reconciliation_groups(organization_id,expense_id,expense_month,amount_cents,note,created_by)
      values(org,e.id,month_date,total,left(coalesce(note,''),500),auth.uid()) returning id into group_id;
    -- Remplace l’estimation par le même montant, au même jour ; aucune dépense ajoutée.
    insert into public.expense_settlements(organization_id,expense_id,period_month,amount_cents,paid_at,bank_transaction_id)
      values(org,e.id,month_date,total,historical_paid_at,first_transaction);
  end if;
  update public.bank_transactions set reconciliation_group_id=group_id,reconciliation='matched',reconciled_at=now(),reconciled_by=auth.uid()
    where id=any(transaction_ids);
  return group_id;
end $$;
revoke all on function public.reconcile_bank_group(uuid[],text,uuid,date,text) from public,anon,service_role;
grant execute on function public.reconcile_bank_group(uuid[],text,uuid,date,text) to authenticated;

-- L’ancien moteur conserve ses protections. Seule cette enveloppe peut l’appeler.
alter function public.reconcile_bank_transaction(uuid,text,uuid,date,jsonb) rename to reconcile_single_bank_transaction;
revoke all on function public.reconcile_single_bank_transaction(uuid,text,uuid,date,jsonb) from public,anon,authenticated,service_role;
create function public.reconcile_bank_transaction(target_transaction uuid,target_kind text,target_id uuid default null,target_month date default null,details jsonb default '{}')
returns uuid language plpgsql security definer set search_path=public as $$
declare tx public.bank_transactions%rowtype; current_group uuid;
begin
  -- Lecture sans verrou : si c’est un groupe, verrouiller tous ses membres dans l’ordre.
  select * into tx from public.bank_transactions where id=target_transaction;
  if not found then raise exception 'Transaction introuvable.'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.has_permission(tx.organization_id,'business.manage'),false) then
    raise exception 'Rapprochement réservé aux associés et administrateurs.';
  end if;
  current_group:=tx.reconciliation_group_id;
  if current_group is not null then
    perform 1 from public.bank_transactions where reconciliation_group_id=current_group order by id for update;
  else
    perform 1 from public.bank_transactions where id=target_transaction for update;
  end if;
  select * into tx from public.bank_transactions where id=target_transaction;
  if tx.reconciliation_group_id is not null then
    if target_kind<>'undo' then raise exception 'Annulez d’abord le regroupement complet.'; end if;
    -- Un groupe formé pendant l’attente sera repris après rechargement.
    if current_group is distinct from tx.reconciliation_group_id then raise exception 'Ce mouvement vient d’être regroupé. Rechargez la page.'; end if;
    delete from public.expense_settlements where bank_transaction_id in (select id from public.bank_transactions where reconciliation_group_id=current_group);
    update public.bank_transactions set reconciliation_group_id=null,reconciliation='unmatched',reconciled_at=null,reconciled_by=null,ignored_reason=null where reconciliation_group_id=current_group;
    delete from public.bank_reconciliation_groups where id=current_group;
    return tx.id;
  end if;
  if target_kind='payment' then
    perform 1 from public.payments where id=target_id and organization_id=tx.organization_id for update;
    if exists(select 1 from public.bank_reconciliation_groups where payment_id=target_id) then raise exception 'Ce paiement est déjà rapproché dans un regroupement.'; end if;
  end if;
  return public.reconcile_single_bank_transaction(target_transaction,target_kind,target_id,target_month,details);
end $$;
revoke all on function public.reconcile_bank_transaction(uuid,text,uuid,date,jsonb) from public,anon;
grant execute on function public.reconcile_bank_transaction(uuid,text,uuid,date,jsonb) to authenticated,service_role;

create function public.protect_historical_bank_group() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='payments' then
    if exists(select 1 from public.bank_reconciliation_groups where payment_id=old.id) then
      if tg_op='DELETE' then raise exception 'Annulez le regroupement Qonto avant de supprimer ce paiement.'; end if;
      if new.amount_cents is distinct from old.amount_cents or new.paid_at is distinct from old.paid_at
        or new.organization_id is distinct from old.organization_id or new.invoice_id is distinct from old.invoice_id
        or new.intervention_id is distinct from old.intervention_id or new.maintenance_contract_id is distinct from old.maintenance_contract_id
        or new.maintenance_billing_period_id is distinct from old.maintenance_billing_period_id then
        raise exception 'Annulez le regroupement Qonto avant de modifier ce paiement.';
      end if;
    end if;
  else
    if exists(select 1 from public.bank_reconciliation_groups where expense_id=old.id) then
      if tg_op='DELETE' then raise exception 'Annulez le regroupement Qonto avant de supprimer cette charge.'; end if;
      if new.paid is distinct from old.paid or new.paid_at is distinct from old.paid_at or new.series_id is distinct from old.series_id
        or new.organization_id is distinct from old.organization_id then raise exception 'Annulez le regroupement Qonto avant de modifier ce règlement historique.'; end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger payments_protect_historical_bank_group before update or delete on public.payments for each row execute function public.protect_historical_bank_group();
create trigger expenses_protect_historical_bank_group before update or delete on public.expenses for each row execute function public.protect_historical_bank_group();

-- Une modification ultérieure d’un membre demande la vérification du groupe entier.
create function public.review_bank_group() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if pg_trigger_depth()=1 and new.reconciliation_group_id is not null and new.reconciliation='review' and old.reconciliation is distinct from 'review' then
    update public.bank_transactions set reconciliation='review' where reconciliation_group_id=new.reconciliation_group_id and reconciliation='matched';
  end if;
  return new;
end $$;
create trigger bank_transactions_review_group after update on public.bank_transactions for each row execute function public.review_bank_group();
