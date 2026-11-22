-- Learn from settled, internally posted debits. The expense remains the only
-- forecast; bank movements and observations are never a second expense ledger.
alter table public.expenses
  add column qonto_recurrence text check(qonto_recurrence in ('estimated','confirmed','expired')),
  add column qonto_recurrence_key text,
  add constraint expense_qonto_recurrence_shape check
    ((qonto_recurrence is null) = (qonto_recurrence_key is null) and (qonto_recurrence is null or recurrence='monthly'));
create unique index expense_qonto_recurrence_unique on public.expenses(organization_id,qonto_recurrence_key)
  where qonto_recurrence in ('estimated','confirmed') and archived_at is null;

create function public.guard_qonto_subscription_origin() returns trigger language plpgsql set search_path=public as $$
begin
  if current_user in ('anon','authenticated') and
    (case when tg_op='INSERT' then new.qonto_recurrence is not null or new.qonto_recurrence_key is not null
      else (new.qonto_recurrence,new.qonto_recurrence_key) is distinct from (old.qonto_recurrence,old.qonto_recurrence_key) end)
    then raise exception 'La détection bancaire est réservée au serveur.'; end if;
  return new;
end $$;
create trigger expenses_guard_subscription_origin before insert or update of qonto_recurrence,qonto_recurrence_key on public.expenses
  for each row execute function public.guard_qonto_subscription_origin();

-- No account identifier or mandate reference is exposed in the expense register.
create function public.qonto_subscription_signal(t public.bank_transactions) returns text
language plpgsql immutable strict set search_path=public as $$
declare words text:=public.qonto_identity(t.label||' '||t.reference); party text:=public.qonto_identity(t.counterparty);
begin
  if t.side<>'debit' or t.currency<>'EUR' or t.amount_cents<=0 or t.status<>'completed' or t.settled_at is null
    or t.operation_type not in ('direct_debit','sepa_direct_debit','direct_debit_hold','card','transfer','qonto_fee')
    or t.monthly_split_rule_id is not null or t.reconciliation_group_id is not null
    or words ~ '\m(annuel(le)?s?|annual(ly)?|yearly|trimestriel(le)?s?|quarterly|semestriel(le)?s?|semestrial|hebdomadaires?|weekly|ponctuel(le)?s?|unique|one off|one time|par an|per year|tous les (deux|trois|six|douze|[2-9]|12) mois|resili[a-z]*|non recurrent|remboursements?|refund|cashback|avoir|virement interne|apport|emprunt|echeance de pret|notes? de frais)\M'
    or words ~ '\m(non|pas) mensuel|\m(exceptionnel(le)?s?|bimestriel(le)?s?|biennial|every (two|three|six) months)\M'
    or (party||' '||words) ~ '\m(retrait|dividendes?|capital social)\M'
    then return null; end if;
  if words ~ '\m(mensuel(le)?s?|mensualites?|monthly|chaque mois|par mois|per month|tous les mois)\M' then return 'monthly'; end if;
  if t.operation_type in ('direct_debit','sepa_direct_debit','direct_debit_hold') or words ~ '\m(prelevements?|prlv|abonnements?|subscriptions?|forfait)\M' then return 'estimate'; end if;
  if t.operation_type in ('card','transfer','qonto_fee') then return 'repeat'; end if;
  return null;
end $$;

create function public.qonto_subscription_party(t public.bank_transactions) returns text
language plpgsql immutable strict set search_path=public as $$
declare p text:=public.qonto_identity(t.counterparty);
begin
  if p='' then
    -- Use a descriptive label only; strip payment boilerplate and date/number
    -- tokens, never infer a supplier from a bare bank/invoice reference.
    p:=trim(regexp_replace(regexp_replace(public.qonto_identity(t.label),
      '\m(prlv|prelevement|sepa|paiement|carte|cb|virement|abonnement|subscription|mensuel|mensuelle|mensualite|monthly|facture|invoice|[0-9]+)\M',' ','g'),' +',' ','g'));
  end if;
  if length(p)<3 or p !~ '[a-z]{2}' or p ~ '^(prlv|sepa|prelevement|virement|carte|card|paiement|payment|inconnu|fournisseur|abonnement|mensuel|facture|echeance|service|direct debit|transfer|cb|[0-9]+| )+$'
    or p ~ '^(stripe|paypal|sumup|adyen|gocardless)( payments?)?$' then return null; end if;
  return p;
end $$;

create function public.qonto_subscription_key(t public.bank_transactions) returns text
language sql immutable strict set search_path=public as $$
  select case when public.qonto_subscription_signal(t) is not null and public.qonto_subscription_party(t) is not null and trim(t.account_id)<>''
    then md5(jsonb_build_array(t.account_id,public.qonto_subscription_party(t),
      case when t.operation_type in ('direct_debit','sepa_direct_debit','direct_debit_hold') then 'sepa' else t.operation_type end)::text) end
$$;

create index bank_subscription_lookup on public.bank_transactions(organization_id,account_id,settled_at)
  where side='debit' and status='completed' and currency='EUR';

create function public.qonto_subscription_due(anchor date,m date) returns date language sql immutable strict as $$
  select m+(least(extract(day from anchor)::int,extract(day from m+interval '1 month - 1 day')::int)-1)
$$;

-- A manual schedule can be added after the bank has already booked a one-off.
-- Reuse its single, unchanged bank receipt; preserve the explicit tariff, all
-- business metadata and the original bank cash date. Never merge guesses.
create function public.attach_qonto_existing_subscription(t public.bank_transactions,e public.expenses,s public.expense_settlements)
returns boolean language plpgsql set search_path=public as $$
declare candidate record; target uuid; nominal date; party text:=public.qonto_subscription_party(t);
begin
  if exists(select 1 from public.assets where expense_id=e.id)
    or exists(select 1 from public.bank_transaction_drafts where expense_id=e.id)
    or exists(select 1 from public.bank_reconciliation_groups where expense_id=e.id)
    or exists(select 1 from public.expenses where replaces_expense_id=e.id)
    or nullif(to_jsonb(e)->>'comment','') is not null or nullif(to_jsonb(e)->>'receipt_path','') is not null
    or (to_jsonb(e)->>'created_at' is not null and to_jsonb(e)->>'updated_at' is distinct from to_jsonb(e)->>'created_at') then return false; end if;
  for candidate in
    select x.id,x.series_id,p.mo from public.expenses x cross join generate_series(-1,1) g(n)
    cross join lateral (select (date_trunc('month',e.expense_date)+make_interval(months=>g.n))::date mo) p
    cross join lateral (select public.qonto_subscription_due(x.expense_date,p.mo) on_day) d
    where x.organization_id=t.organization_id and x.archived_at is null and x.qonto_recurrence_key is null
      and x.recurrence in ('monthly','annual') and (x.recurrence='monthly' or extract(month from p.mo)=extract(month from x.expense_date))
      and party=coalesce(nullif(public.qonto_identity(x.supplier),''),public.qonto_identity(x.description))
      and d.on_day between x.expense_date and coalesce(x.ends_on,'infinity'::date) and abs(d.on_day-e.expense_date)<=7
    order by x.id for update of x loop
    if target is not null or exists(select 1 from public.expense_settlements es join public.expenses v on v.id=es.expense_id
        where v.organization_id=t.organization_id and coalesce(v.series_id,v.id)=coalesce(candidate.series_id,candidate.id) and es.period_month=candidate.mo)
      then return false; end if;
    target:=candidate.id; nominal:=candidate.mo;
  end loop;
  if target is null or not exists(select 1 from public.expenses x where x.id=target and
      (x.amount_including_tax_cents=t.amount_cents or (t.operation_type in ('direct_debit','direct_debit_hold','sepa_direct_debit')
        and public.qonto_identity(x.supplier)=public.qonto_identity(t.counterparty))))
    then return false; end if;
  update public.expense_settlements set expense_id=target,period_month=nominal where id=s.id;
  update public.bank_transactions set expense_id=target,expense_month=nominal,created_entry=false,posting_kind='matched',
    automation_note='Débit déjà enregistré, rattaché à la charge récurrente du registre.' where id=t.id;
  update public.expenses set archived_at=now() where id=e.id;
  return true;
end $$;

-- Once per completed sync, including when nothing new was downloaded. Only an
-- untouched, bank-created one-off can become a new rule. Older manual/grouped
-- payments can never be overwritten or used as a pretext for a new booking.
create function public.refresh_qonto_subscriptions(target_org uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare
  t public.bank_transactions%rowtype; e public.expenses%rowtype; s public.expense_settlements%rowtype;
  prior public.bank_transactions%rowtype; fingerprint text; confidence text; day date; m date; cutoff timestamptz;
  today date:=(now() at time zone 'Europe/Paris')::date; n int:=0; evidence int; explicit_month boolean; last_month date;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text,330033));
  select posting_from into cutoff from public.qonto_connections where organization_id=target_org and enabled for update;
  if not found then return 0; end if;
  -- After an undo/reversal, don't leave an unsupported estimate in forecasts.
  -- Never reopen an ended/revised tariff or alter an independently managed successor.
  for e in select * from public.expenses x where x.organization_id=target_org and x.qonto_recurrence in ('confirmed','estimated') and x.archived_at is null
    and not exists(select 1 from public.expenses v where v.organization_id=target_org and v.replaces_expense_id=x.id)
    and (x.ends_on is null or x.qonto_recurrence='estimated') order by x.id for update loop
    select count(distinct es.period_month), bool_or(public.qonto_subscription_signal(b)='monthly'), max(es.period_month)
      into evidence,explicit_month,last_month
      from public.expense_settlements es join public.expenses v on v.id=es.expense_id
      join public.bank_transactions b on b.id=es.bank_transaction_id
      where v.organization_id=target_org and v.series_id=e.series_id and es.organization_id=target_org
        and b.organization_id=target_org and b.reconciliation='matched' and b.status='completed' and public.qonto_subscription_key(b)=e.qonto_recurrence_key;
    if evidence=0 then
      if not exists(select 1 from public.expense_settlements where expense_id=e.id) then
        update public.expenses set archived_at=now() where id=e.id;
      else
        -- A corrected payee/label can disprove the cadence without reversing
        -- the money. Keep the genuine receipts, only retire the forecast.
        select max(period_month) into last_month from public.expense_settlements where expense_id=e.id;
        update public.expenses set qonto_recurrence='expired',ends_on=(last_month+interval '1 month - 1 day')::date where id=e.id;
      end if;
    elsif evidence=1 and not explicit_month and e.qonto_recurrence='confirmed' then
      update public.expenses set qonto_recurrence='estimated',ends_on=(last_month+interval '2 months - 1 day')::date where id=e.id;
    elsif (evidence>=2 or explicit_month) and e.qonto_recurrence='estimated' then
      update public.expenses set qonto_recurrence='confirmed',ends_on=null where id=e.id;
    elsif evidence=1 and not explicit_month and e.qonto_recurrence='estimated'
      and today>public.qonto_subscription_due(e.expense_date,(last_month+interval '1 month')::date)+10 then
      -- An isolated guess isn't a permanent debt. Keep the paid month intact.
      update public.expenses set qonto_recurrence='expired',ends_on=(greatest(last_month,date_trunc('month',e.expense_date)::date)+interval '1 month - 1 day')::date where id=e.id;
    end if;
  end loop;

  -- Latest booked occurrence first: don't invent unpaid instalments between
  -- past purchases. Old, inactive vendors do not resurrect a subscription.
  for t in select b.* from public.bank_transactions b join public.expenses x on x.id=b.expense_id
    where b.organization_id=target_org and x.organization_id=target_org and b.side='debit' and b.status='completed' and b.currency='EUR'
      and b.reconciliation='matched' and b.posting_kind='expense' and b.created_entry and b.settled_at<=now()
      and b.settled_at>=cutoff and b.settled_at>=(greatest(date '2026-06-24',today-45)::timestamp at time zone 'Europe/Paris')
      and x.recurrence='one_off' and x.archived_at is null and x.family in ('fixed','variable')
      and (x.series_id is null or x.series_id=x.id) and x.replaces_expense_id is null
      and public.qonto_subscription_key(b) is not null
    order by b.settled_at desc,b.id for update of b loop
    fingerprint:=public.qonto_subscription_key(t); day:=(t.settled_at at time zone 'Europe/Paris')::date; m:=date_trunc('month',day)::date;
    select * into strict e from public.expenses where id=t.expense_id and organization_id=target_org for update;
    if e.recurrence<>'one_off' or e.archived_at is not null or e.paid or e.created_by is not null or e.ends_on is not null
      or e.expense_date<>day or e.amount_including_tax_cents<>t.amount_cents or public.qonto_split_rule_for(t) is not null then continue; end if;
    if nullif(to_jsonb(e)->>'legacy_id','') is not null or nullif(to_jsonb(e)->>'import_fingerprint','') is not null
      or exists(select 1 from public.assets a where a.expense_id=e.id) then continue; end if;
    if e.description is distinct from left(coalesce(nullif(trim(t.label),''),nullif(trim(t.counterparty),''),'Dépense Qonto'),160)
      or e.supplier is distinct from t.counterparty then continue; end if;
    if (select count(*) from public.bank_transactions b where b.organization_id=target_org and b.account_id=t.account_id and b.side='debit' and b.currency='EUR' and b.status='completed'
      and b.settled_at>=(m::timestamp at time zone 'Europe/Paris') and b.settled_at<((m+interval '1 month') at time zone 'Europe/Paris')
      and public.qonto_subscription_key(b)=fingerprint and b.settled_at<=now())<>1 then continue; end if;
    select * into s from public.expense_settlements where organization_id=target_org and expense_id=e.id and bank_transaction_id=t.id
      and split_leg=0 and period_month=m and amount_cents=t.amount_cents and paid_at=t.settled_at for update;
    if not found or exists(select 1 from public.expense_settlements where expense_id=e.id and id<>s.id) then continue; end if;
    -- A manually added monthly/annual tariff takes priority over a guessed plan.
    if exists(select 1 from public.expenses x where x.organization_id=target_org and x.archived_at is null
      and x.qonto_recurrence_key is null and x.recurrence<>'one_off' and (x.ends_on is null or x.ends_on>=day-7)
      and public.qonto_subscription_party(t) in (public.qonto_identity(x.supplier),public.qonto_identity(x.description))) then
      if public.attach_qonto_existing_subscription(t,e,s) then n:=n+1; end if;
      continue;
    end if;
    if exists(select 1 from public.expenses x where x.organization_id=target_org and x.archived_at is null and
      x.qonto_recurrence_key=fingerprint and x.qonto_recurrence<>'expired') then continue; end if;
    select * into prior from public.bank_transactions b where b.organization_id=target_org and b.account_id=t.account_id and b.side='debit' and b.currency='EUR' and b.status='completed'
      and public.qonto_subscription_key(b)=fingerprint and b.reconciliation='matched' and b.posting_kind='expense' and b.created_entry
      and b.settled_at>=cutoff and b.settled_at>=((m-interval '1 month') at time zone 'Europe/Paris') and b.settled_at<(m::timestamp at time zone 'Europe/Paris')
      and b.settled_at>=(timestamp '2026-06-24' at time zone 'Europe/Paris')
      and abs(public.qonto_subscription_due((b.settled_at at time zone 'Europe/Paris')::date,m)-day)<=6
      and (b.amount_cents=t.amount_cents or (public.qonto_subscription_signal(t)<>'repeat' and abs(b.amount_cents-t.amount_cents)<=greatest(100::numeric,b.amount_cents::numeric*0.20)))
      and exists(select 1 from public.expenses v where v.id=b.expense_id and v.organization_id=target_org and v.archived_at is null and v.recurrence='one_off'
        and not v.paid and v.created_by is null and (v.series_id is null or v.series_id=v.id) and v.replaces_expense_id is null)
      and exists(select 1 from public.expense_settlements proof where proof.organization_id=target_org and proof.expense_id=b.expense_id
        and proof.bank_transaction_id=b.id and proof.amount_cents=b.amount_cents and proof.paid_at=b.settled_at and proof.split_leg=0)
      and not exists(select 1 from public.bank_transactions other where other.organization_id=target_org and other.account_id=t.account_id and other.id<>b.id
        and other.side='debit' and other.currency='EUR' and other.status='completed' and public.qonto_subscription_key(other)=fingerprint
        and other.settled_at>=((m-interval '1 month') at time zone 'Europe/Paris') and other.settled_at<(m::timestamp at time zone 'Europe/Paris'))
      order by b.settled_at desc limit 1;
    confidence:=case when public.qonto_subscription_signal(t)='monthly' or prior.id is not null then 'confirmed'
      when public.qonto_subscription_signal(t)='estimate' then 'estimated' end;
    if confidence is null or (confidence='estimated' and today>public.qonto_subscription_due(day,(m+interval '1 month')::date)+10) then continue; end if;
    -- Preserve both IDs and every cent. Detach/re-attach the *same* evidence
    -- atomically; the ordinary guard remains active for all other writers.
    delete from public.expense_settlements where id=s.id;
    update public.expenses set recurrence='monthly',series_id=coalesce(series_id,id),qonto_recurrence=confidence,qonto_recurrence_key=fingerprint,
      ends_on=case when confidence='estimated' then (m+interval '2 months - 1 day')::date end where id=e.id;
    insert into public.expense_settlements select (s).*;
    update public.bank_transactions set created_entry=false,posting_kind='matched',automation_note=case when confidence='estimated'
      then 'Premier débit réglé ; prochaine mensualité estimée.' else 'Abonnement mensuel détecté ; échéance réglée.' end where id=t.id;
    -- A previous independently posted charge keeps its own ID, amount, date and
    -- settlement. Sharing the series groups it without projecting it a second time.
    if prior.id is not null then
      update public.expenses set series_id=coalesce(e.series_id,e.id) where id=prior.expense_id and organization_id=target_org and recurrence='one_off'
        and archived_at is null and created_by is null and (series_id is null or series_id=id);
    end if;
    n:=n+1;
  end loop;
  return n;
end $$;

-- A complete sync already uses this posting gate. Resolve learned schedules
-- inside the same SQL transaction as the settlement, even for a stale worker
-- snapshot. Explicit split rules and manually recorded matches retain priority.
alter function public.post_qonto_transaction(uuid,bigint,timestamptz,jsonb) rename to post_qonto_before_subscriptions;
create function public.post_qonto_transaction(target_transaction uuid,expected_amount bigint,expected_settled_at timestamptz,decision jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.bank_transactions%rowtype; rule public.expenses%rowtype; v public.expenses%rowtype;
  supplied public.expenses%rowtype; conn public.qonto_connections%rowtype; fp text; day date; m date; due date; previous_amount bigint; posting_org uuid;
  ambiguous text:='Plusieurs débits ou charges possibles pour cette mensualité. Aucun double règlement créé.';
begin
  select organization_id into strict posting_org from public.bank_transactions where id=target_transaction;
  perform pg_advisory_xact_lock(hashtextextended(posting_org::text,330033));
  select * into strict t from public.bank_transactions where id=target_transaction for update;
  if t.side<>'debit' or public.qonto_split_rule_for(t) is not null then
    return public.post_qonto_before_subscriptions(t.id,expected_amount,expected_settled_at,decision); end if;
  fp:=public.qonto_subscription_key(t);
  day:=(t.settled_at at time zone 'Europe/Paris')::date;
  select * into rule from public.expenses where organization_id=t.organization_id and archived_at is null
    and qonto_recurrence_key=fp and (qonto_recurrence in ('estimated','confirmed') or
      (qonto_recurrence='expired' and abs(public.qonto_subscription_due(expense_date,(ends_on+1))-day)<=7
        and exists(select 1 from public.expense_settlements es join public.bank_transactions old_tx on old_tx.id=es.bank_transaction_id
          where es.expense_id=expenses.id and old_tx.organization_id=t.organization_id and old_tx.reconciliation='matched' and public.qonto_subscription_key(old_tx)=fp)
        and not exists(select 1 from public.expenses successor where successor.organization_id=t.organization_id and successor.replaces_expense_id=expenses.id)))
    order by (qonto_recurrence='expired'),expense_date desc,id limit 1 for update;
  if decision->>'action'='match' and decision->>'kind'='expense' then
    select * into supplied from public.expenses where organization_id=t.organization_id and id=(decision->>'id')::uuid;
    if supplied.qonto_recurrence_key is not null
    then
      if rule.id is null or supplied.series_id is distinct from rule.series_id then
        decision:=jsonb_set(decision,'{action}','"defer"')||jsonb_build_object('reason',ambiguous);
      end if;
    else return public.post_qonto_before_subscriptions(t.id,expected_amount,expected_settled_at,decision); end if;
  end if;
  if rule.id is null or decision->>'action' not in ('expense','match') then
    return public.post_qonto_before_subscriptions(t.id,expected_amount,expected_settled_at,decision); end if;
  select * into strict conn from public.qonto_connections where organization_id=t.organization_id for update;
  if not conn.enabled or t.reconciliation<>'unmatched' or t.automated_at is not null or t.reconciliation_group_id is not null or t.settled_at>now()
    or t.expense_id is not null or t.payment_id is not null or t.settled_at<conn.posting_from
    or (t.settled_at at time zone 'Europe/Paris')::date<date '2026-06-24'
    or exists(select 1 from public.bank_transaction_drafts d where d.bank_transaction_id=t.id and (d.status<>'pending' or d.updated_at<>d.created_at) and coalesce(t.posting_kind,'') not in ('repost','bank_only'))
    then return jsonb_build_object('skipped',true); end if;
  if (t.amount_cents,t.settled_at) is distinct from (expected_amount,expected_settled_at)
    or (decision ? 'version' and t.remote_updated_at is distinct from (decision->>'version')::timestamptz)
    then raise exception 'Le mouvement bancaire a changé.'; end if;
  perform 1 from public.expenses where organization_id=t.organization_id and series_id=rule.series_id order by id for update;
  select x.id,months.mo,dates.on_day into v.id,m,due from generate_series(-1,1) offsets(n)
    cross join lateral (select (date_trunc('month',day)+make_interval(months=>offsets.n))::date mo) months
    cross join lateral (select z.* from public.expenses z where z.organization_id=t.organization_id and z.series_id=rule.series_id and z.archived_at is null
      and (public.qonto_subscription_due(z.expense_date,months.mo) between z.expense_date and coalesce(z.ends_on,'infinity'::date)
        or (z.id=rule.id and rule.qonto_recurrence='expired' and months.mo=z.ends_on+1))
      order by z.expense_date desc,z.id limit 1) x
    cross join lateral (select public.qonto_subscription_due(x.expense_date,months.mo) on_day) dates
    where x.recurrence='monthly' and (x.id=rule.id or public.qonto_subscription_party(t)=coalesce(nullif(public.qonto_identity(x.supplier),''),public.qonto_identity(x.description)))
      and abs(dates.on_day-day)<=7 order by abs(dates.on_day-day),x.expense_date desc limit 1;
  if v.id is null then
    -- A generic match must not resurrect an expired or revised subscription.
    if supplied.id is not null then decision:=jsonb_set(decision,'{action}','"defer"')||jsonb_build_object('reason',ambiguous); end if;
    return public.post_qonto_before_subscriptions(t.id,expected_amount,expected_settled_at,decision);
  end if;
  select * into strict v from public.expenses where id=v.id;
  select es.amount_cents into previous_amount from public.expense_settlements es where es.expense_id=v.id and es.period_month<m
    order by es.period_month desc limit 1;
  if exists(select 1 from public.expense_settlements es join public.expenses x on x.id=es.expense_id
      where x.organization_id=t.organization_id and x.series_id=rule.series_id and es.period_month=m)
    or exists(select 1 from public.bank_transactions b where b.organization_id=t.organization_id and b.account_id=t.account_id and b.id<>t.id
      and b.side='debit' and b.currency='EUR' and b.status='completed' and b.settled_at<=now() and b.reconciliation not in ('ignored','review')
      and b.settled_at>=((due-7)::timestamp at time zone 'Europe/Paris') and b.settled_at<((due+8)::timestamp at time zone 'Europe/Paris')
      and public.qonto_subscription_key(b)=fp)
    or (public.qonto_subscription_signal(t)='repeat' and t.amount_cents not in (v.amount_including_tax_cents,coalesce(previous_amount,v.amount_including_tax_cents)))
    or exists(select 1 from public.expenses x where x.organization_id=t.organization_id and x.archived_at is null and x.recurrence='one_off'
      and x.series_id is distinct from rule.series_id and abs(x.expense_date-day)<=10 and x.amount_including_tax_cents=t.amount_cents
      and not public.is_recorded_cash_charge(x) and not exists(select 1 from public.expense_settlements s where s.expense_id=x.id)
      and public.qonto_subscription_party(t) in (public.qonto_identity(x.supplier),public.qonto_identity(x.description)))
    then
      update public.bank_transactions set posting_kind='bank_only',automation_note=ambiguous where id=t.id;
      return jsonb_build_object('kind','bank_only');
  end if;
  insert into public.expense_settlements(organization_id,expense_id,period_month,amount_cents,paid_at,bank_transaction_id)
    values(t.organization_id,v.id,m,t.amount_cents,t.settled_at,t.id);
  update public.bank_transactions set expense_id=v.id,expense_month=m,reconciliation='matched',created_entry=false,posting_kind='matched',
    automated_at=now(),reconciled_at=now(),automation_note='Débit rattaché à la mensualité existante, sans nouvelle charge.' where id=t.id;
  if rule.qonto_recurrence in ('estimated','expired') and v.id=rule.id then update public.expenses set qonto_recurrence='confirmed',ends_on=null where id=rule.id; end if;
  return jsonb_build_object('kind','matched');
end $$;

revoke all on function public.guard_qonto_subscription_origin(),public.qonto_subscription_signal(public.bank_transactions),public.qonto_subscription_party(public.bank_transactions),
  public.qonto_subscription_key(public.bank_transactions),public.qonto_subscription_due(date,date),
  public.attach_qonto_existing_subscription(public.bank_transactions,public.expenses,public.expense_settlements),
  public.post_qonto_before_subscriptions(uuid,bigint,timestamptz,jsonb),public.refresh_qonto_subscriptions(uuid),
  public.post_qonto_transaction(uuid,bigint,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.refresh_qonto_subscriptions(uuid),public.post_qonto_transaction(uuid,bigint,timestamptz,jsonb) to service_role;
