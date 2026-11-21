-- One explicitly identified outgoing transfer can settle two monthly schedules.
-- Installing the migration alone does not configure an organisation or change its history.
create table public.qonto_monthly_split_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  seed_transaction_id uuid not null unique references public.bank_transactions(id),
  first_series uuid not null, second_series uuid not null check (first_series<>second_series),
  account_key text not null, beneficiary_key text not null, reference_key text not null,
  enabled boolean not null default true,
  unique (organization_id,account_key,beneficiary_key,reference_key)
);
-- Exceptional historical amounts are confirmed by bank ID and exact bank facts,
-- never learned as a wider tolerance for future transfers.
create table public.qonto_monthly_split_exceptions (
  transaction_id uuid primary key references public.bank_transactions(id),
  rule_id uuid not null references public.qonto_monthly_split_rules(id),
  expected_amount bigint not null check(expected_amount>0), expected_at timestamptz not null,
  first_cents bigint not null check(first_cents>0), second_cents bigint not null check(second_cents>0)
);
alter table public.qonto_monthly_split_rules enable row level security;
alter table public.qonto_monthly_split_exceptions enable row level security;
revoke all on public.qonto_monthly_split_rules,public.qonto_monthly_split_exceptions from public,anon,authenticated,service_role;

alter table public.bank_transactions
  add column monthly_split_rule_id uuid references public.qonto_monthly_split_rules(id),
  add column split_cash_delta_cents bigint not null default 0,
  add column split_was_ignored boolean not null default false,
  add constraint bank_split_shape check (case when monthly_split_rule_id is null then split_cash_delta_cents=0 and not split_was_ignored
    else payment_id is null and expense_id is null and reconciliation_group_id is null and not created_entry and expense_month is not null
      and reconciliation in ('matched','review') end);
alter table public.expense_settlements
  add column split_leg smallint not null default 0 check(split_leg between 0 and 2),
  add column cash_delta_cents bigint not null default 0 check(split_leg=1 or cash_delta_cents=0),
  drop constraint expense_settlements_bank_transaction_id_key,
  add unique(bank_transaction_id,split_leg);
-- Ordinary transfers still have exactly one slot (0); split transfers only slots 1 and 2.
create function public.guard_qonto_split_leg() returns trigger language plpgsql set search_path=public as $$
declare tx public.bank_transactions%rowtype;
begin
  select * into strict tx from public.bank_transactions where id=new.bank_transaction_id for update;
  if tx.organization_id<>new.organization_id or ((new.split_leg=0)<>(tx.monthly_split_rule_id is null))
    or (new.split_leg=1 and new.cash_delta_cents<>tx.split_cash_delta_cents) then raise exception 'Répartition bancaire incompatible.'; end if;
  return new;
end $$;
create trigger expense_settlement_split_leg before insert or update on public.expense_settlements for each row execute function public.guard_qonto_split_leg();

create function public.qonto_split_beneficiary(cp text, label text) returns text language sql immutable set search_path=public as $$
  select public.qonto_identity(coalesce(nullif(trim(cp),''),label))
$$;
create index bank_split_lookup on public.bank_transactions(organization_id,account_id,public.qonto_split_beneficiary(counterparty,label),public.qonto_identity(reference),settled_at)
  where side='debit' and operation_type='transfer' and status='completed' and currency='EUR';
create function public.qonto_split_rounds(actual bigint, planned bigint) returns boolean language sql immutable as $$
  select planned>0 and actual in (planned, ((planned+99)/100)*100, ((planned+499)/500)*500)
$$;
create function public.qonto_split_dues(r public.qonto_monthly_split_rules, m date)
returns table(leg integer, expense_id uuid, due_on date, cents bigint, title text) language sql stable set search_path=public as $$
  select keys.leg,v.id,v.due,v.amount_including_tax_cents,coalesce(nullif(v.description,''),v.category)
  from (values (1,r.first_series),(2,r.second_series)) keys(leg,series)
  cross join lateral (select e.*, d.due from public.expenses e
    cross join lateral (select m+least(extract(day from e.expense_date)::int,extract(day from m+interval '1 month - 1 day')::int)-1 as due) d
    where e.organization_id=r.organization_id and e.series_id=keys.series and e.archived_at is null and e.recurrence='monthly'
      and e.family in ('fixed','variable') and d.due between e.expense_date and coalesce(e.ends_on,'infinity'::date)
    order by e.expense_date desc,e.id limit 1) v
$$;
create function public.qonto_split_rule_for(tx public.bank_transactions) returns uuid language sql stable set search_path=public as $$
  select r.id from public.qonto_monthly_split_rules r where r.enabled and r.organization_id=tx.organization_id and r.account_key=tx.account_id
    and tx.side='debit' and tx.operation_type='transfer' and tx.currency='EUR' and tx.status='completed' and tx.settled_at<=now()
    and r.beneficiary_key=public.qonto_split_beneficiary(tx.counterparty,tx.label) and r.reference_key=public.qonto_identity(tx.reference)
$$;

-- Read-only decision is shared by preview, backfill and live posting.
create function public.qonto_split_plan(tx public.bank_transactions,r public.qonto_monthly_split_rules) returns jsonb
language plpgsql stable set search_path=public as $$
declare
  d date:=(tx.settled_at at time zone 'Europe/Paris')::date; m date:=date_trunc('month',d)::date;
  a record; b record; x public.qonto_monthly_split_exceptions%rowtype; delta bigint; matches int;
begin
  if public.qonto_split_rule_for(tx) is distinct from r.id then return jsonb_build_object('state','other'); end if;
  if tx.monthly_split_rule_id=r.id and tx.reconciliation='matched' then return jsonb_build_object('state','booked'); end if;
  select * into x from public.qonto_monthly_split_exceptions where transaction_id=tx.id and rule_id=r.id;
  if tx.reconciliation not in ('unmatched','ignored') or tx.payment_id is not null or tx.expense_id is not null or tx.reconciliation_group_id is not null
    or tx.created_entry or exists(select 1 from public.expense_settlements s where s.bank_transaction_id=tx.id)
    or (tx.reconciliation='ignored' and tx.id<>r.seed_transaction_id and x.transaction_id is null)
    or exists(select 1 from public.bank_transaction_drafts dr where dr.bank_transaction_id=tx.id and (dr.status<>'pending' or dr.updated_at<>dr.created_at))
    then return jsonb_build_object('state','protected'); end if;
  select * into a from public.qonto_split_dues(r,m) where leg=1;
  select * into b from public.qonto_split_dues(r,m) where leg=2;
  if a.expense_id is null or b.expense_id is null or a.cents<=0 or b.cents<=0 or abs(a.due_on-d)>7 or abs(b.due_on-d)>7
    then return jsonb_build_object('state','dates'); end if;
  -- Do not drop a protected/manual one-off or pay the same month on a superseded tariff.
  if exists(select 1 from public.expense_settlements s join public.expenses e on e.id=s.expense_id
      where e.organization_id=r.organization_id and e.series_id in (r.first_series,r.second_series) and s.period_month=m)
    or exists(select 1 from public.expenses e where e.organization_id=r.organization_id and e.archived_at is null and e.recurrence='one_off'
      and e.amount_including_tax_cents=tx.amount_cents and abs(e.expense_date-d)<=7)
    then return jsonb_build_object('state','occupied'); end if;
  if x.transaction_id is not null then
    if (x.expected_amount,x.expected_at) is distinct from (tx.amount_cents,tx.settled_at) then return jsonb_build_object('state','changed'); end if;
  elsif not public.qonto_split_rounds(tx.amount_cents,a.cents+b.cents) then return jsonb_build_object('state','amount'); end if;
  select count(*) into matches from public.bank_transactions t where t.organization_id=r.organization_id and t.account_id=r.account_key
    and t.side='debit' and t.operation_type='transfer' and t.status='completed' and t.currency='EUR' and t.settled_at<=now()
    and public.qonto_split_beneficiary(t.counterparty,t.label)=r.beneficiary_key and public.qonto_identity(t.reference)=r.reference_key
    and (t.settled_at at time zone 'Europe/Paris')::date between greatest(m,a.due_on-7,b.due_on-7)
      and least((m+interval '1 month - 1 day')::date,a.due_on+7,b.due_on+7)
    and (public.qonto_split_rounds(t.amount_cents,a.cents+b.cents) or exists (select 1 from public.qonto_monthly_split_exceptions z
      where z.rule_id=r.id and z.transaction_id=t.id and z.expected_amount=t.amount_cents and z.expected_at=t.settled_at));
  if matches<>1 then return jsonb_build_object('state','ambiguous'); end if;
  delta:=tx.amount_cents-coalesce(x.first_cents,a.cents)-coalesce(x.second_cents,b.cents);
  return jsonb_build_object('state','ready','month',m,'first',a.expense_id,'second',b.expense_id,
    'first_cents',coalesce(x.first_cents,a.cents),'second_cents',coalesce(x.second_cents,b.cents),'delta',delta,'exception',x.transaction_id is not null,
    'first_title',left(a.title,90),'second_title',left(b.title,90));
end $$;

create function public.qonto_split_euros(cents bigint) returns text language sql immutable as $$
  select replace((cents::numeric/100)::numeric(20,2)::text,'.',',')||' €'
$$;
create function public.apply_qonto_monthly_split(target_transaction uuid,target_rule uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare tx public.bank_transactions%rowtype; r public.qonto_monthly_split_rules%rowtype; p jsonb; m date; delta bigint; note text;
begin
  select * into strict tx from public.bank_transactions where id=target_transaction for update;
  select * into strict r from public.qonto_monthly_split_rules where id=target_rule and organization_id=tx.organization_id for update;
  if not exists(select 1 from public.qonto_connections where organization_id=r.organization_id and enabled) then return jsonb_build_object('skipped',true); end if;
  perform 1 from public.expenses where organization_id=r.organization_id and series_id in (r.first_series,r.second_series) order by id for update;
  p:=public.qonto_split_plan(tx,r);
  if p->>'state'<>'ready' then
    if p->>'state' not in ('booked','protected','other') and tx.reconciliation='unmatched' then
      note:='Virement groupé au journal : montant, date ou échéances à identifier. Aucune charge supplémentaire créée.';
      update public.bank_transactions set posting_kind='bank_only',automation_note=note where id=tx.id and (posting_kind,automation_note) is distinct from ('bank_only',note);
      return jsonb_build_object('kind','bank_only','state',p->>'state');
    end if;
    return jsonb_build_object('skipped',true,'state',p->>'state');
  end if;
  m:=(p->>'month')::date; delta:=(p->>'delta')::bigint;
  note:=concat('Virement réparti : ',p->>'first_title',' · ',public.qonto_split_euros((p->>'first_cents')::bigint),' ; ',
    p->>'second_title',' · ',public.qonto_split_euros((p->>'second_cents')::bigint),'.',case when delta<>0 then
    concat(case when (p->>'exception')::boolean then ' Écart confirmé' else ' Arrondi' end,' (trésorerie uniquement) : ',public.qonto_split_euros(delta),'.') end);
  update public.bank_transactions set monthly_split_rule_id=r.id,split_was_ignored=(reconciliation='ignored'),split_cash_delta_cents=delta,
    expense_month=m,reconciliation='matched',posting_kind='matched',automated_at=now(),reconciled_at=now(),automation_note=note where id=tx.id;
  insert into public.expense_settlements(organization_id,expense_id,period_month,amount_cents,paid_at,bank_transaction_id,split_leg,cash_delta_cents) values
    (r.organization_id,(p->>'first')::uuid,m,(p->>'first_cents')::bigint,tx.settled_at,tx.id,1,delta),
    (r.organization_id,(p->>'second')::uuid,m,(p->>'second_cents')::bigint,tx.settled_at,tx.id,2,0);
  return jsonb_build_object('kind','matched','state','applied');
end $$;

-- Only explicitly configured clients are examined. A replay does not rewrite
-- journal dates or settlements. Historical ignores require individual consent.
create function public.apply_qonto_split_history(target_org uuid) returns int language plpgsql security definer set search_path=public as $$
declare item record; n int:=0;
begin
  for item in select t.id,r.id as rule from public.qonto_monthly_split_rules r join public.bank_transactions t
    on t.organization_id=r.organization_id and t.account_id=r.account_key and public.qonto_split_beneficiary(t.counterparty,t.label)=r.beneficiary_key
    and public.qonto_identity(t.reference)=r.reference_key
    where r.organization_id=target_org and r.enabled and t.side='debit' and t.operation_type='transfer' and t.currency='EUR' and t.status='completed'
      and t.settled_at<=now() and (t.reconciliation='unmatched' or (t.reconciliation='ignored' and
        (r.seed_transaction_id=t.id or exists(select 1 from public.qonto_monthly_split_exceptions x where x.transaction_id=t.id and x.rule_id=r.id))))
    order by t.id loop
    if public.apply_qonto_monthly_split(item.id,item.rule)->>'state'='applied' then n:=n+1; end if;
  end loop;
  return n;
end $$;

-- Setup validates the real, confirmed seed before committing the rule. No
-- beneficiary, organisation identifier or private bank reference in source control.
create function public.enable_qonto_monthly_split(target_org uuid,seed uuid,first_expense uuid,second_expense uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare t public.bank_transactions%rowtype; a uuid; b uuid; rule uuid; recipient text; p jsonb;
begin
  select * into strict t from public.bank_transactions where id=seed and organization_id=target_org for update;
  select series_id into strict a from public.expenses where id=first_expense and organization_id=target_org and recurrence='monthly' and archived_at is null;
  select series_id into strict b from public.expenses where id=second_expense and organization_id=target_org and recurrence='monthly' and archived_at is null;
  recipient:=public.qonto_split_beneficiary(t.counterparty,t.label);
  if a=b or length(recipient)<4 or recipient !~ '[a-z]' or recipient ~ '^(virements?|sepa|transfer|emis|instantane|qonto|paiement| )+$'
    or trim(t.account_id)='' then raise exception 'Bénéficiaire ou séries insuffisamment identifiables.'; end if;
  insert into public.qonto_monthly_split_rules(organization_id,seed_transaction_id,first_series,second_series,account_key,beneficiary_key,reference_key)
    values(target_org,seed,a,b,t.account_id,recipient,public.qonto_identity(t.reference)) on conflict(seed_transaction_id) do nothing;
  select id into strict rule from public.qonto_monthly_split_rules where seed_transaction_id=seed and organization_id=target_org and first_series=a and second_series=b and enabled;
  p:=public.apply_qonto_monthly_split(seed,rule);
  if coalesce(p->>'state','') not in ('booked','applied') then raise exception 'Virement témoin non rapprochable : %',p; end if;
  return rule;
end $$;

-- An operator may attach an exceptional historical transfer only after the client
-- has confirmed both allocations. Failure to settle rolls the confirmation back.
create function public.confirm_qonto_split_history(target_org uuid,target_rule uuid,target_transaction uuid,bank_day date,
  bank_cents bigint,first_share bigint,second_share bigint) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.qonto_monthly_split_rules%rowtype; t public.bank_transactions%rowtype; p jsonb;
begin
  select * into strict t from public.bank_transactions where id=target_transaction and organization_id=target_org for update;
  select * into strict r from public.qonto_monthly_split_rules where id=target_rule and organization_id=target_org for update;
  if public.qonto_split_rule_for(t) is distinct from r.id or (t.amount_cents,(t.settled_at at time zone 'Europe/Paris')::date)
    is distinct from (bank_cents,bank_day) or first_share is null or second_share is null or least(first_share,second_share)<=0
    then raise exception 'Ce virement ne correspond pas aux montants et à la date confirmés.'; end if;
  if t.monthly_split_rule_id is not null and not exists(select 1 from public.qonto_monthly_split_exceptions where transaction_id=t.id)
    then raise exception 'Ce virement est déjà réparti.'; end if;
  insert into public.qonto_monthly_split_exceptions(transaction_id,rule_id,expected_amount,expected_at,first_cents,second_cents)
    values(t.id,r.id,bank_cents,t.settled_at,first_share,second_share) on conflict(transaction_id) do nothing;
  if not exists(select 1 from public.qonto_monthly_split_exceptions where transaction_id=t.id and rule_id=r.id and
    (expected_amount,expected_at,first_cents,second_cents)=(bank_cents,t.settled_at,first_share,second_share)) then raise exception 'Une autre répartition est déjà confirmée.'; end if;
  p:=public.apply_qonto_monthly_split(t.id,r.id);
  if coalesce(p->>'state','') not in ('applied','booked') then raise exception 'Historique protégé ou ambigu : %',p; end if;
  return p;
end $$;

-- A changed/reversed bank row must reopen both instalments together. Compare
-- the bank fingerprint too, even if Qonto only changed the beneficiary.
create function public.invalidate_qonto_split() returns trigger language plpgsql set search_path=public as $$
begin
  if old.monthly_split_rule_id is not null and (new.status,new.side,new.amount_cents,new.currency,new.settled_at,new.operation_type,new.account_id,
    public.qonto_split_beneficiary(new.counterparty,new.label),public.qonto_identity(new.reference)) is distinct from
    (old.status,old.side,old.amount_cents,old.currency,old.settled_at,old.operation_type,old.account_id,
    public.qonto_split_beneficiary(old.counterparty,old.label),public.qonto_identity(old.reference)) then new.reconciliation:='review'; end if;
  return new;
end $$;
create trigger bank_invalidate_split before update of remote_updated_at on public.bank_transactions for each row execute function public.invalidate_qonto_split();

-- The existing sync calls repair after importing all accounts/pages and before
-- single-item posting. Keep that contract, including for already deployed apps.
alter function public.repair_qonto_postings(uuid) rename to repair_qonto_single_postings;
create function public.repair_qonto_postings(target_org uuid) returns integer language plpgsql security definer set search_path=public as $$
declare t public.bank_transactions%rowtype; n int:=0;
begin
  if not exists(select 1 from public.qonto_connections where organization_id=target_org and enabled) then return 0; end if;
  for t in select * from public.bank_transactions where organization_id=target_org and monthly_split_rule_id is not null and reconciliation='review' order by id for update loop
    delete from public.expense_settlements where bank_transaction_id=t.id and split_leg in (1,2);
    update public.bank_transactions set monthly_split_rule_id=null,split_cash_delta_cents=0,split_was_ignored=false,expense_month=null,
      reconciliation=case when t.split_was_ignored then 'ignored' else 'unmatched' end,posting_kind=case when t.split_was_ignored then null else 'repost' end,
      automated_at=null,reconciled_at=null,automation_note='Virement groupé corrigé par la banque ; échéances rouvertes.' where id=t.id;
    n:=n+1;
  end loop;
  n:=n+public.repair_qonto_single_postings(target_org);
  return n+public.apply_qonto_split_history(target_org);
end $$;
alter function public.post_qonto_transaction(uuid,bigint,timestamptz,jsonb) rename to post_qonto_single_transaction;
create function public.post_qonto_transaction(target_transaction uuid,expected_amount bigint,expected_settled_at timestamptz,decision jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.bank_transactions%rowtype; r uuid;
begin
  select * into strict t from public.bank_transactions where id=target_transaction for update;
  r:=public.qonto_split_rule_for(t);
  if r is null then return public.post_qonto_single_transaction(target_transaction,expected_amount,expected_settled_at,decision); end if;
  if t.amount_cents is distinct from expected_amount or t.settled_at is distinct from expected_settled_at
    or (decision ? 'version' and t.remote_updated_at is distinct from (decision->>'version')::timestamptz) then raise exception 'Le mouvement bancaire a changé.'; end if;
  return public.apply_qonto_monthly_split(t.id,r);
end $$;
revoke all on function public.qonto_split_plan(public.bank_transactions,public.qonto_monthly_split_rules),public.qonto_split_rule_for(public.bank_transactions),
  public.qonto_split_dues(public.qonto_monthly_split_rules,date),public.apply_qonto_monthly_split(uuid,uuid),public.apply_qonto_split_history(uuid),
  public.enable_qonto_monthly_split(uuid,uuid,uuid,uuid),public.confirm_qonto_split_history(uuid,uuid,uuid,date,bigint,bigint,bigint),
  public.post_qonto_single_transaction(uuid,bigint,timestamptz,jsonb),
  public.repair_qonto_single_postings(uuid),public.repair_qonto_postings(uuid),public.post_qonto_transaction(uuid,bigint,timestamptz,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.repair_qonto_postings(uuid),public.post_qonto_transaction(uuid,bigint,timestamptz,jsonb) to service_role;
