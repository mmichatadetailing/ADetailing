-- Qonto est consulté uniquement côté serveur. Aucun identifiant bancaire n’est
-- lisible via l’API publique, même par un associé connecté.
create table public.qonto_connections (
  organization_id uuid primary key references public.organizations(id),
  location_id uuid references public.locations(id),
  remote_organization_id text not null,
  organization_name text not null,
  credentials_encrypted text not null,
  accounts jsonb not null default '[]',
  import_since date not null,
  enabled boolean not null default true,
  auto_reconcile boolean not null default false,
  cursor_at timestamptz not null,
  window_to timestamptz,
  account_index integer not null default 0,
  next_page integer not null default 1,
  last_synced_at timestamptz,
  last_error text,
  lease_token uuid,
  lease_until timestamptz,
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.qonto_connections enable row level security;
revoke all on public.qonto_connections from anon, authenticated;
grant all on public.qonto_connections to service_role;

create or replace function public.guard_qonto_connection() returns trigger language plpgsql set search_path=public as $$
begin
  if new.remote_organization_id is distinct from old.remote_organization_id then
    raise exception 'Impossible de mélanger les historiques de deux entreprises Qonto.';
  end if;
  if new.enabled and old.lease_until>now() and (
    new.credentials_encrypted is distinct from old.credentials_encrypted or new.accounts is distinct from old.accounts
    or new.import_since is distinct from old.import_since
  ) then raise exception 'Une synchronisation Qonto est en cours. Attendez sa fin.'; end if;
  return new;
end $$;
create trigger qonto_connections_guard before update on public.qonto_connections for each row execute function public.guard_qonto_connection();

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  remote_id text not null,
  remote_organization_id text not null,
  account_name text not null,
  account_id text not null,
  label text not null default '', counterparty text not null default '', reference text not null default '',
  amount_cents bigint not null check (amount_cents >= 0), currency text not null,
  side text not null check (side in ('credit','debit')),
  status text not null check (status in ('pending','completed','declined','reversed')),
  settled_at timestamptz, emitted_at timestamptz not null, remote_updated_at timestamptz not null,
  operation_type text not null,
  reconciliation text not null default 'unmatched' check (reconciliation in ('unmatched','matched','ignored','review')),
  payment_id uuid references public.payments(id),
  expense_id uuid references public.expenses(id), expense_month date,
  created_entry boolean not null default false,
  ignored_reason text, reconciled_at timestamptz, reconciled_by uuid references public.profiles(id),
  unique (organization_id,remote_organization_id,remote_id), unique(payment_id),
  check (not (payment_id is not null and expense_id is not null))
);
create index bank_transactions_inbox on public.bank_transactions(organization_id,reconciliation,emitted_at desc);
create unique index bank_expense_occurrence_unique on public.bank_transactions(expense_id,expense_month) where expense_id is not null;
alter table public.bank_transactions enable row level security;
create policy bank_transactions_managers_read on public.bank_transactions for select to authenticated
  using (public.has_permission(organization_id,'business.manage'));
revoke insert,update,delete on public.bank_transactions from authenticated,anon;
grant select on public.bank_transactions to authenticated;
grant all on public.bank_transactions to service_role;

create table public.expense_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  expense_id uuid not null references public.expenses(id),
  period_month date not null, amount_cents bigint not null check (amount_cents > 0),
  paid_at timestamptz not null,
  bank_transaction_id uuid not null unique references public.bank_transactions(id),
  unique(expense_id,period_month)
);
alter table public.expense_settlements enable row level security;
create policy expense_settlements_org_read on public.expense_settlements for select to authenticated
  using (public.has_permission(organization_id,'finance.read'));
revoke insert,update,delete on public.expense_settlements from authenticated,anon;
grant select on public.expense_settlements to authenticated;
grant all on public.expense_settlements to service_role;

create or replace function public.ingest_qonto_transactions(target_org uuid, entries jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare entry jsonb;
begin
  if not exists(select 1 from public.qonto_connections where organization_id=target_org and enabled) then
    raise exception 'La synchronisation Qonto est désactivée.';
  end if;
  for entry in select value from jsonb_array_elements(entries) loop
    insert into public.bank_transactions(organization_id,remote_id,remote_organization_id,account_name,account_id,label,counterparty,reference,amount_cents,currency,side,status,settled_at,emitted_at,remote_updated_at,operation_type)
    values(target_org,entry->>'remote_id',entry->>'remote_organization_id',entry->>'account_name',entry->>'account_id',entry->>'label',entry->>'counterparty',entry->>'reference',(entry->>'amount_cents')::bigint,entry->>'currency',entry->>'side',entry->>'status',(entry->>'settled_at')::timestamptz,(entry->>'emitted_at')::timestamptz,(entry->>'remote_updated_at')::timestamptz,entry->>'operation_type')
    on conflict(organization_id,remote_organization_id,remote_id) do update set
      label=excluded.label,counterparty=excluded.counterparty,reference=excluded.reference,
      amount_cents=excluded.amount_cents,currency=excluded.currency,side=excluded.side,status=excluded.status,
      settled_at=excluded.settled_at,emitted_at=excluded.emitted_at,remote_updated_at=excluded.remote_updated_at,
      operation_type=excluded.operation_type,
      reconciliation=case when bank_transactions.reconciliation in ('matched','review') and
        (excluded.status<>'completed' or excluded.amount_cents<>bank_transactions.amount_cents or excluded.currency<>bank_transactions.currency or excluded.side<>bank_transactions.side or excluded.settled_at is distinct from bank_transactions.settled_at)
        then 'review' else bank_transactions.reconciliation end
    where excluded.remote_updated_at >= bank_transactions.remote_updated_at;
  end loop;
end $$;
revoke all on function public.ingest_qonto_transactions(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_qonto_transactions(uuid,jsonb) to service_role;

-- Cette fonction est la seule porte d’écriture du rapprochement : verrouillage
-- de la transaction ET de sa cible, puis création/lien dans la même transaction SQL.
create or replace function public.reconcile_bank_transaction(
  target_transaction uuid, target_kind text, target_id uuid default null,
  target_month date default null, details jsonb default '{}'
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  tx public.bank_transactions%rowtype; p public.payments%rowtype; e public.expenses%rowtype;
  job public.interventions%rowtype; inv public.invoices%rowtype; period public.maintenance_billing_periods%rowtype;
  total bigint; already_paid bigint; result_id uuid; expected_date date; month_date date; owner_location uuid;
begin
  select * into tx from public.bank_transactions where id=target_transaction for update;
  if not found then raise exception 'Transaction introuvable.'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.has_permission(tx.organization_id,'business.manage'),false) then
    raise exception 'Rapprochement réservé aux associés et administrateurs.';
  end if;
  if target_kind='undo' then
    -- Le lien est retiré avant de supprimer une écriture créée par la banque.
    update public.bank_transactions set payment_id=null,expense_id=null,expense_month=null,
      reconciliation='unmatched',created_entry=false,reconciled_at=null,ignored_reason=null where id=tx.id;
    delete from public.expense_settlements where bank_transaction_id=tx.id;
    if tx.created_entry and tx.payment_id is not null then
      select * into p from public.payments where id=tx.payment_id for update;
      delete from public.payments where id=tx.payment_id;
      if p.maintenance_billing_period_id is not null then
        update public.maintenance_billing_periods set status='due',paid_at=null,payment_method=null where id=p.maintenance_billing_period_id;
      end if;
    end if;
    -- Une charge créée explicitement reste une charge prévue, mais non réglée.
    return tx.id;
  end if;
  if tx.reconciliation='matched' then return tx.id; end if;
  if tx.reconciliation<>'unmatched' then raise exception 'Annulez d’abord le traitement actuel de cette transaction.'; end if;
  if target_kind='ignore' then
    if length(trim(coalesce(details->>'reason','')))<3 then raise exception 'Indiquez un motif de classement.'; end if;
    update public.bank_transactions set reconciliation='ignored',ignored_reason=left(details->>'reason',500),reconciled_at=now(),reconciled_by=auth.uid() where id=tx.id;
    return tx.id;
  end if;
  if tx.status<>'completed' or tx.currency<>'EUR' or tx.amount_cents<=0 or tx.settled_at is null
    or tx.settled_at>now() or tx.operation_type='internal_transfer' then
    raise exception 'Seules les opérations EUR terminées hors virements internes sont rapprochables.';
  end if;
  select location_id into owner_location from public.qonto_connections where organization_id=tx.organization_id;
  if target_kind='payment' then
    select * into p from public.payments where id=target_id and organization_id=tx.organization_id for update;
    if not found or tx.side<>'credit' or p.amount_cents<>tx.amount_cents then raise exception 'Le paiement ne correspond pas au montant reçu.'; end if;
    update public.bank_transactions set payment_id=p.id,reconciliation='matched',created_entry=false,reconciled_at=now(),reconciled_by=auth.uid() where id=tx.id;
  elsif target_kind in ('expense','new_expense') then
    if tx.side<>'debit' then raise exception 'Une charge doit correspondre à une sortie bancaire.'; end if;
    if target_kind='new_expense' then
      if length(trim(coalesce(details->>'description','')))<2 or length(trim(coalesce(details->>'category','')))<2 then raise exception 'Libellé et catégorie requis.'; end if;
      -- Une charge identique doit être rapprochée, jamais recréée à l’aveugle.
      if exists(select 1 from public.expenses where organization_id=tx.organization_id and archived_at is null
        and amount_including_tax_cents=tx.amount_cents and abs(expense_date::date-(tx.settled_at at time zone 'Europe/Paris')::date)<=10
        and lower(description)=lower(details->>'description')) then raise exception 'Une charge semblable existe déjà. Choisissez-la dans la liste.'; end if;
      insert into public.expenses(organization_id,location_id,expense_date,family,category,supplier,description,amount_including_tax_cents,amount_excluding_tax_cents,vat_amount_cents,vat_recoverable,recurrence,allocated_month,paid,created_by)
      values(tx.organization_id,owner_location,(tx.settled_at at time zone 'Europe/Paris')::date,'variable',left(details->>'category',120),tx.counterparty,left(details->>'description',300),tx.amount_cents,tx.amount_cents,0,false,'one_off',date_trunc('month',tx.settled_at at time zone 'Europe/Paris')::date,false,auth.uid()) returning id into target_id;
    end if;
    select * into e from public.expenses where id=target_id and organization_id=tx.organization_id and archived_at is null for update;
    if not found or e.amount_including_tax_cents<>tx.amount_cents then raise exception 'Le montant de la charge doit correspondre exactement au débit.'; end if;
    month_date:=date_trunc('month',coalesce(target_month,(tx.settled_at at time zone 'Europe/Paris')::date))::date;
    if e.series_id is not null then
      perform 1 from public.expenses where organization_id=e.organization_id and series_id=e.series_id order by id for update;
      if exists(select 1 from public.expense_settlements s join public.expenses version on version.id=s.expense_id
        where version.organization_id=e.organization_id and version.series_id=e.series_id and s.period_month=month_date) then
        raise exception 'Cette échéance est déjà réglée sur un autre tarif du même abonnement.';
      end if;
    end if;
    if month_date<date_trunc('month',e.expense_date)::date or (e.recurrence='one_off' and month_date<>date_trunc('month',e.expense_date)::date)
      or (e.recurrence='annual' and extract(month from month_date)<>extract(month from e.expense_date)) then raise exception 'Cette charge n’a pas d’échéance sur ce mois.'; end if;
    expected_date:=month_date + (least(extract(day from e.expense_date)::integer,extract(day from month_date+interval '1 month - 1 day')::integer)-1);
    if e.ends_on is not null and expected_date>e.ends_on then raise exception 'Cet ancien tarif n’est plus applicable.'; end if;
    if e.series_id is not null and exists(select 1 from public.expenses newer where newer.organization_id=e.organization_id and newer.series_id=e.series_id and newer.archived_at is null and newer.expense_date>e.expense_date and date_trunc('month',newer.expense_date)::date<=month_date and (newer.ends_on is null or newer.ends_on>=month_date)) then raise exception 'Sélectionnez le tarif applicable à cette échéance.'; end if;
    if abs(expected_date-(tx.settled_at at time zone 'Europe/Paris')::date)>45 then raise exception 'La date bancaire est trop éloignée de cette échéance.'; end if;
    insert into public.expense_settlements(organization_id,expense_id,period_month,amount_cents,paid_at,bank_transaction_id)
      values(tx.organization_id,e.id,month_date,tx.amount_cents,tx.settled_at,tx.id);
    update public.bank_transactions set expense_id=e.id,expense_month=month_date,reconciliation='matched',created_entry=(target_kind='new_expense'),reconciled_at=now(),reconciled_by=auth.uid() where id=tx.id;
  elsif target_kind in ('intervention','invoice','maintenance') then
    if tx.side<>'credit' then raise exception 'Un encaissement doit correspondre à une entrée bancaire.'; end if;
    if target_kind='intervention' then
      select * into job from public.interventions where id=target_id and organization_id=tx.organization_id and archived_at is null for update;
      if not found or job.status<>'completed' or job.maintenance_contract_id is not null or job.invoice_id is not null then raise exception 'Sélectionnez une prestation terminée sans facture ni contrat d’entretien.'; end if;
      select coalesce(sum(revenue_allocated_cents),0) into total from public.intervention_items where intervention_id=job.id;
      select coalesce(sum(amount_cents),0) into already_paid from public.payments where intervention_id=job.id;
    elsif target_kind='invoice' then
      select * into inv from public.invoices where id=target_id and organization_id=tx.organization_id and archived_at is null for update;
      if not found or inv.status in ('cancelled','credit_note') then raise exception 'Facture introuvable ou annulée.'; end if;
      -- Même verrou que les paiements directs si une prestation utilise la facture.
      perform 1 from public.interventions where invoice_id=inv.id for update;
      total:=inv.total_including_tax_cents;
      select coalesce(sum(amount_cents),0) into already_paid from public.payments where invoice_id=inv.id
        or intervention_id in (select id from public.interventions where invoice_id=inv.id);
    else
      select * into period from public.maintenance_billing_periods where id=target_id and organization_id=tx.organization_id for update;
      if not found or period.status<>'due' then raise exception 'Échéance déjà encaissée ou annulée. Rapprochez le paiement existant.'; end if;
      if period.amount_cents<>tx.amount_cents then raise exception 'Le règlement doit couvrir exactement l’échéance d’entretien.'; end if;
      total:=period.amount_cents; already_paid:=0;
    end if;
    if tx.amount_cents>total-already_paid then raise exception 'Ce règlement dépasse le solde. Vérifiez les paiements déjà saisis.'; end if;
    insert into public.payments(organization_id,location_id,invoice_id,intervention_id,maintenance_contract_id,maintenance_billing_period_id,amount_cents,paid_at,method,reference,created_by)
      values(tx.organization_id,owner_location,case when target_kind='invoice' then inv.id end,case when target_kind='intervention' then job.id end,case when target_kind='maintenance' then period.contract_id end,case when target_kind='maintenance' then period.id end,tx.amount_cents,tx.settled_at,'Virement Qonto',tx.remote_id,auth.uid()) returning id into result_id;
    if target_kind='maintenance' then update public.maintenance_billing_periods set status='paid',paid_at=tx.settled_at,payment_method='Virement Qonto' where id=period.id; end if;
    update public.bank_transactions set payment_id=result_id,reconciliation='matched',created_entry=true,reconciled_at=now(),reconciled_by=auth.uid() where id=tx.id;
  else raise exception 'Type de rapprochement non reconnu.';
  end if;
  return tx.id;
end $$;
revoke all on function public.reconcile_bank_transaction(uuid,text,uuid,date,jsonb) from public,anon;
grant execute on function public.reconcile_bank_transaction(uuid,text,uuid,date,jsonb) to authenticated,service_role;

-- Ne pas pouvoir supprimer/modifier un paiement pointé à la banque sans défaire
-- explicitement son rapprochement (y compris depuis l’écran Entretiens).
create or replace function public.protect_reconciled_payment() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.bank_transactions where payment_id=old.id) then
    if tg_op='DELETE' then raise exception 'Annulez le rapprochement Qonto avant de supprimer ce paiement.'; end if;
    if new.amount_cents<>old.amount_cents or new.paid_at<>old.paid_at or new.invoice_id is distinct from old.invoice_id or new.intervention_id is distinct from old.intervention_id or new.maintenance_billing_period_id is distinct from old.maintenance_billing_period_id then
      raise exception 'Annulez le rapprochement Qonto avant de modifier ce paiement.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger payments_protect_bank_link before update or delete on public.payments for each row execute function public.protect_reconciled_payment();

-- Le verrou s’applique aussi aux anciennes routes de paiement manuel : deux
-- onglets ou une synchro simultanée ne peuvent pas dépasser le solde du dossier.
create or replace function public.guard_payment_balance() returns trigger language plpgsql security definer set search_path=public as $$
declare total bigint; paid bigint; source_org uuid; source_invoice uuid;
begin
  if new.invoice_id is not null then
    select total_including_tax_cents,organization_id into total,source_org from public.invoices where id=new.invoice_id for update;
    perform 1 from public.interventions where invoice_id=new.invoice_id for update;
    select coalesce(sum(amount_cents),0) into paid from public.payments where id<>new.id and
      (invoice_id=new.invoice_id or intervention_id in (select id from public.interventions where invoice_id=new.invoice_id));
  elsif new.intervention_id is not null then
    select organization_id,invoice_id into source_org,source_invoice from public.interventions where id=new.intervention_id for update;
    if source_invoice is not null then
      select total_including_tax_cents into total from public.invoices where id=source_invoice and organization_id=new.organization_id for update;
      select coalesce(sum(amount_cents),0) into paid from public.payments where id<>new.id and
        (invoice_id=source_invoice or intervention_id in (select id from public.interventions where invoice_id=source_invoice));
    else
      select coalesce(sum(revenue_allocated_cents),0) into total from public.intervention_items where intervention_id=new.intervention_id;
      select coalesce(sum(amount_cents),0) into paid from public.payments where intervention_id=new.intervention_id and id<>new.id;
    end if;
  elsif new.maintenance_billing_period_id is not null then
    select amount_cents,organization_id into total,source_org from public.maintenance_billing_periods where id=new.maintenance_billing_period_id for update;
    select coalesce(sum(amount_cents),0) into paid from public.payments where maintenance_billing_period_id=new.maintenance_billing_period_id and id<>new.id;
  end if;
  if source_org is distinct from new.organization_id or total is null or new.amount_cents+paid>total then
    raise exception 'Le paiement dépasse le solde du dossier ou ne correspond pas à cette entreprise.';
  end if;
  return new;
end $$;
create trigger payments_guard_balance before insert or update on public.payments for each row execute function public.guard_payment_balance();

create or replace function public.protect_reconciled_expense() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.expense_settlements where expense_id=old.id) and (
    new.amount_including_tax_cents<>old.amount_including_tax_cents or new.expense_date<>old.expense_date
    or new.recurrence<>old.recurrence or new.archived_at is distinct from old.archived_at
    or (new.ends_on is not null and exists(select 1 from public.expense_settlements s where s.expense_id=old.id
      and s.period_month+(least(extract(day from old.expense_date)::integer,extract(day from s.period_month+interval '1 month - 1 day')::integer)-1)>new.ends_on))
  ) then raise exception 'Cette charge possède un règlement Qonto. Annulez son rapprochement avant de modifier son historique ou de la supprimer.'; end if;
  return new;
end $$;
create trigger expenses_protect_bank_settlement before update on public.expenses for each row execute function public.protect_reconciled_expense();
