-- One server-owned posting path. Keep legacy tables, prior links and explicit
-- dismissals; never backdate the creation of new activity into imported history.
alter table public.qonto_connections add column posting_from timestamptz;
alter table public.qonto_connections add column posting_pending boolean not null default false;
-- Import-only connections may already have years of manually compacted history.
update public.qonto_connections set posting_from=case when auto_intake then auto_intake_from else now() end;
alter table public.qonto_connections alter column posting_from set default now(), alter column posting_from set not null;
alter table public.bank_transactions add column posting_kind text
  check (posting_kind in ('service','expense','matched','ignored','bank_only','repost'));
update public.bank_transactions set posting_kind=case
  when reconciliation='ignored' then 'ignored'
  when automation_note like 'Prestation terminée et encaissement créés%' then 'service'
  when automation_note like 'Charge créée et réglée%' then 'expense' else 'matched' end
where automated_at is not null and reconciliation in ('matched','ignored','review');
update public.bank_transactions b set automation_note='Archive : ancienne proposition écartée ou personnalisée, conservée sans nouvelle écriture.'
from public.bank_transaction_drafts d where d.bank_transaction_id=b.id and b.reconciliation='unmatched'
  and b.automated_at is null and (d.status='dismissed' or (d.status='pending' and d.created_at<>d.updated_at));

-- Older clients must not be able to start a second, manual posting workflow.
revoke execute on function public.manage_bank_draft(uuid,text,jsonb),
  public.reconcile_bank_group(uuid[],text,uuid,date,text),
  public.reconcile_bank_transaction(uuid,text,uuid,date,jsonb) from authenticated;
revoke execute on function public.prepare_qonto_drafts(uuid),
  public.automate_qonto_transaction(uuid,bigint,timestamptz,jsonb) from service_role;

create function public.post_qonto_transaction(target_transaction uuid, expected_amount bigint, expected_settled_at timestamptz, decision jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
<<post>>
declare
  tx public.bank_transactions%rowtype; conn public.qonto_connections%rowtype;
  draft public.bank_transaction_drafts%rowtype; e public.expenses%rowtype;
  action text:=decision->>'action'; kind text:=decision->>'kind'; target uuid:=nullif(decision->>'id','')::uuid;
  period date:=nullif(decision->>'month','')::date; day date; due_date date;
  result_kind text; note text; title text; category_name text; learned_family public.expenses.family%type;
  customer uuid; names uuid[]; customer_name text; job uuid; payment uuid; charge uuid;
begin
  select * into strict tx from public.bank_transactions where id=target_transaction for update;
  select * into strict conn from public.qonto_connections where organization_id=tx.organization_id for update;
  if not conn.enabled or tx.reconciliation<>'unmatched' or tx.reconciliation_group_id is not null or tx.automated_at is not null
    or tx.status<>'completed' or tx.currency<>'EUR' or tx.amount_cents<=0 or tx.settled_at is null or tx.settled_at>now()
    then return jsonb_build_object('skipped',true); end if;
  if tx.amount_cents is distinct from expected_amount or tx.settled_at is distinct from expected_settled_at
    or (decision ? 'version' and tx.remote_updated_at is distinct from (decision->>'version')::timestamptz)
    then raise exception 'Le mouvement bancaire a changé.'; end if;
  select * into draft from public.bank_transaction_drafts where bank_transaction_id=tx.id for update;
  if found and coalesce(tx.posting_kind,'') not in ('repost','bank_only') and (draft.status<>'pending' or draft.updated_at<>draft.created_at) then return jsonb_build_object('skipped',true); end if;
  if tx.settled_at<conn.posting_from and draft.id is null then
    if action<>'match' or kind not in ('payment','expense') then return jsonb_build_object('skipped',true); end if;
    if kind='expense' and not exists(select 1 from public.expenses where id=target and organization_id=tx.organization_id and paid) then return jsonb_build_object('skipped',true); end if;
  end if;
  day:=(tx.settled_at at time zone 'Europe/Paris')::date;
  if action='defer' then
    update public.bank_transactions set posting_kind='bank_only',automation_note=left(decision->>'reason',500) where id=tx.id;
    return jsonb_build_object('kind','bank_only');
  elsif action='ignore' then
    note:=left(decision->>'reason',500);
    perform public.reconcile_bank_transaction(tx.id,'ignore',null,null,jsonb_build_object('reason',note));
    result_kind:='ignored';
  elsif action='match' and kind in ('payment','expense','intervention','invoice','maintenance') then
    if decision->>'variableDebit'='true' then
      select * into strict e from public.expenses where id=target and organization_id=tx.organization_id and archived_at is null for update;
      if e.recurrence not in ('monthly','annual') or tx.side<>'debit' or tx.operation_type='internal_transfer'
        or (tx.operation_type not in ('direct_debit','direct_debit_hold','sepa_direct_debit') and public.qonto_identity(tx.label) !~ '\m(prlv|prelevement)\M')
        or length(public.qonto_identity(tx.counterparty))<3 or public.qonto_identity(e.supplier)<>public.qonto_identity(tx.counterparty)
        or period is null or period<>date_trunc('month',period)::date or (e.recurrence='annual' and extract(month from period)<>extract(month from e.expense_date))
        then raise exception 'Échéance de prélèvement incompatible.'; end if;
      due_date:=period+(least(extract(day from e.expense_date)::int,extract(day from period+interval '1 month - 1 day')::int)-1);
      if due_date<e.expense_date or due_date>coalesce(e.ends_on,'infinity'::date) or abs(due_date-day)>7 then raise exception 'Échéance hors période.'; end if;
      if e.series_id is not null then
        perform 1 from public.expenses where organization_id=e.organization_id and series_id=e.series_id order by id for update;
        if exists(select 1 from public.expenses v where v.organization_id=e.organization_id and v.series_id=e.series_id and
          (exists(select 1 from public.expense_settlements s where s.expense_id=v.id and s.period_month=period)
          or (v.archived_at is null and v.expense_date>e.expense_date and date_trunc('month',v.expense_date)::date<=period and (v.ends_on is null or v.ends_on>=period))))
          then raise exception 'Échéance déjà réglée ou tarif remplacé.'; end if;
      end if;
      insert into public.expense_settlements(organization_id,expense_id,period_month,amount_cents,paid_at,bank_transaction_id)
        values(tx.organization_id,e.id,period,tx.amount_cents,tx.settled_at,tx.id);
      update public.bank_transactions set expense_id=e.id,expense_month=period,reconciliation='matched',reconciled_at=now() where id=tx.id;
    else
      perform public.reconcile_bank_transaction(tx.id,kind,target,period);
    end if;
    result_kind:='matched'; note:='Rattaché à une écriture existante, sans doublon.';
  elsif action='expense' and tx.side='debit' and tx.operation_type<>'internal_transfer' then
    title:=left(coalesce(nullif(trim(tx.label),''),nullif(trim(tx.counterparty),''),'Dépense Qonto'),160);
    -- Repeated card payments with different bank IDs are real purchases. Only
    -- unsettled lookalikes block a second posting, never an already funded row.
    if exists(select 1 from public.expenses x where x.organization_id=tx.organization_id and x.archived_at is null
      and x.recurrence='one_off' and x.amount_including_tax_cents=tx.amount_cents and abs(x.expense_date-day)<=10
      and (public.qonto_identity(x.description)=public.qonto_identity(title) or
        (length(public.qonto_identity(tx.counterparty))>=3 and public.qonto_identity(x.supplier)=public.qonto_identity(tx.counterparty)))
      and not exists(select 1 from public.expense_settlements s where s.expense_id=x.id)
      and not exists(select 1 from public.bank_reconciliation_groups g where g.expense_id=x.id)) or
      ((tx.operation_type in ('direct_debit','direct_debit_hold','sepa_direct_debit') or public.qonto_identity(tx.label) ~ '\m(prlv|prelevement)\M') and exists(
        select 1 from public.expenses x
        cross join generate_series(-1,1) d(offset_month)
        cross join lateral (select (date_trunc('month',day)+make_interval(months=>d.offset_month))::date m) m
        cross join lateral (select m.m+(least(extract(day from x.expense_date)::int,extract(day from m.m+interval '1 month - 1 day')::int)-1) due) due
        where x.organization_id=tx.organization_id and x.archived_at is null and x.recurrence in ('monthly','annual')
        and length(public.qonto_identity(tx.counterparty))>=3 and public.qonto_identity(x.supplier)=public.qonto_identity(tx.counterparty)
        and due.due between x.expense_date and coalesce(x.ends_on,'infinity'::date) and abs(due.due-day)<=7
        and (x.recurrence='monthly' or extract(month from m.m)=extract(month from x.expense_date))
        and not exists(select 1 from public.expense_settlements s where s.expense_id=x.id and s.period_month=m.m))) then
      update public.bank_transactions set posting_kind='bank_only',automation_note='Dépense similaire déjà saisie. Rattachement réévalué automatiquement.' where id=tx.id;
      return jsonb_build_object('kind','bank_only');
    end if;
    select case when count(distinct x.category)=1 then min(x.category) end,
      case when count(distinct x.family)=1 then min(x.family::text) end into category_name, learned_family from public.expenses x
      where x.organization_id=tx.organization_id and x.archived_at is null and length(public.qonto_identity(tx.counterparty))>=3
        and public.qonto_identity(x.supplier)=public.qonto_identity(tx.counterparty);
    insert into public.expenses(organization_id,location_id,expense_date,family,category,supplier,description,amount_including_tax_cents,amount_excluding_tax_cents,vat_amount_cents,vat_recoverable,recurrence,allocated_month,paid)
      values(tx.organization_id,conn.location_id,day,coalesce(learned_family,'variable'),coalesce(nullif(category_name,''),left(nullif(decision->>'category',''),120),'Achats Qonto'),
        tx.counterparty,title,tx.amount_cents,tx.amount_cents,0,false,'one_off',date_trunc('month',day)::date,false) returning id into charge;
    perform public.reconcile_bank_transaction(tx.id,'expense',charge,date_trunc('month',day)::date);
    update public.bank_transactions set created_entry=true where id=tx.id;
    result_kind:='expense'; note:='Charge créée et réglée au montant bancaire. Aucune TVA déduite automatiquement.';
  elsif action='service' and tx.side='credit' and tx.operation_type in ('transfer','income') then
    customer:=nullif(decision->>'clientId','')::uuid; customer_name:=left(trim(decision->>'clientName'),300);
    if customer is null then
      if length(public.qonto_identity(customer_name))<3 or public.qonto_identity(customer_name)<>public.qonto_identity(tx.counterparty) then raise exception 'Nom bancaire manquant.'; end if;
      select array_agg(c.id) into names from public.clients c where c.organization_id=tx.organization_id and c.archived_at is null
        and public.qonto_identity(customer_name) in (public.qonto_identity(c.company),public.qonto_identity(c.first_name||' '||c.last_name),public.qonto_identity(c.last_name||' '||c.first_name));
      if cardinality(names)>1 then
        update public.bank_transactions set posting_kind='bank_only',automation_note='Homonymes : encaissement conservé au journal.' where id=tx.id;
        return jsonb_build_object('kind','bank_only');
      end if;
      customer:=names[1];
    end if;
    if customer is null then
      insert into public.clients(organization_id,location_id,kind,first_name,last_name,notes) values(tx.organization_id,conn.location_id,'individual','',customer_name,'Fiche créée depuis Qonto.') returning id into customer;
    else
      perform 1 from public.clients where id=customer and organization_id=tx.organization_id and archived_at is null for update;
      if not found then raise exception 'Client hors entreprise ou archivé.'; end if;
      if exists(select 1 from public.interventions j where j.organization_id=tx.organization_id and j.client_id=customer and j.archived_at is null and j.status<>'cancelled'
        and (j.status<>'completed' or (abs(extract(epoch from j.start_at-tx.settled_at))<=7*86400
          and (select coalesce(sum(i.revenue_allocated_cents),0) from public.intervention_items i where i.intervention_id=j.id)>
              (select coalesce(sum(p.amount_cents),0) from public.payments p where p.intervention_id=j.id or p.invoice_id=j.invoice_id))))
        or exists(select 1 from public.maintenance_contracts mc join public.maintenance_billing_periods b on b.contract_id=mc.id where mc.organization_id=tx.organization_id and mc.client_id=customer and mc.archived_at is null and b.status='due')
        or exists(select 1 from public.invoices i where i.organization_id=tx.organization_id and i.client_id=customer and i.archived_at is null and i.status not in ('cancelled','credit_note','paid')
          and i.total_including_tax_cents>(select coalesce(sum(p.amount_cents),0) from public.payments p where p.invoice_id=i.id or p.intervention_id in (select j.id from public.interventions j where j.invoice_id=i.id))) then
        update public.bank_transactions set posting_kind='bank_only',automation_note='Dossier ouvert : encaissement conservé sans créer de prestation en double.' where id=tx.id;
        return jsonb_build_object('kind','bank_only');
      end if;
    end if;
    title:=left(coalesce(nullif(trim(tx.label),''),'Prestation · '||customer_name),160);
    insert into public.interventions(organization_id,location_id,client_id,title,status,start_at,planned_duration_minutes,notes)
      values(tx.organization_id,conn.location_id,customer,title,'completed',tx.settled_at,0,'Prestation créée automatiquement depuis un encaissement Qonto.') returning id into job;
    insert into public.intervention_items(organization_id,intervention_id,label,quantity,revenue_allocated_cents) values(tx.organization_id,job,title,1,tx.amount_cents);
    insert into public.payments(organization_id,location_id,intervention_id,amount_cents,paid_at,method,reference) values(tx.organization_id,conn.location_id,job,tx.amount_cents,tx.settled_at,'Virement Qonto',tx.remote_id) returning id into payment;
    update public.bank_transactions set payment_id=payment,reconciliation='matched',created_entry=true,reconciled_at=now() where id=tx.id;
    result_kind:='service'; note:='Prestation terminée et paiement enregistrés à la date bancaire.';
  else raise exception 'Décision bancaire incompatible.'; end if;
  update public.bank_transactions set posting_kind=result_kind,automated_at=now(),automation_note=note where id=tx.id;
  return jsonb_build_object('kind',result_kind);
end $$;
revoke all on function public.post_qonto_transaction(uuid,bigint,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.post_qonto_transaction(uuid,bigint,timestamptz,jsonb) to service_role;

-- A correction from the bank invalidates our own posting, including an earlier
-- automatic exclusion. An explicitly created historical group is never undone.
create function public.invalidate_qonto_posting() returns trigger language plpgsql set search_path=public as $$
begin
  if old.posting_kind in ('ignored','service','expense','matched') and old.reconciliation in ('ignored','matched')
    and old.reconciliation_group_id is null and
    row(new.status,new.amount_cents,new.side,new.currency,new.settled_at,new.operation_type,new.counterparty,new.label,new.reference)
      is distinct from row(old.status,old.amount_cents,old.side,old.currency,old.settled_at,old.operation_type,old.counterparty,old.label,old.reference) then
    -- A routine label edit should not reverse a paid business dossier. However,
    -- re-evaluate categorisation for an exclusion or a newly identified own transfer.
    if old.posting_kind='ignored' or new.operation_type='internal_transfer' or
      row(new.status,new.amount_cents,new.side,new.currency,new.settled_at)
        is distinct from row(old.status,old.amount_cents,old.side,old.currency,old.settled_at) then new.reconciliation:='review'; end if;
  end if;
  return new;
end $$;
create trigger bank_invalidate_auto before update of remote_updated_at on public.bank_transactions for each row execute function public.invalidate_qonto_posting();

create function public.repair_qonto_postings(target_org uuid) returns integer language plpgsql security definer set search_path=public as $$
declare tx public.bank_transactions%rowtype; job uuid; quantity integer:=0;
begin
  if not exists(select 1 from public.qonto_connections where organization_id=target_org and enabled) then return 0; end if;
  for tx in select * from public.bank_transactions where organization_id=target_org and reconciliation='review'
    and reconciliation_group_id is null and posting_kind in ('service','expense','matched','ignored') order by id for update loop
    job:=null;
    if tx.posting_kind='service' then select intervention_id into job from public.payments where id=tx.payment_id; end if;
    -- Existing manual payments survive an unlink; generated payments are reversed
    -- and an unpaid maintenance period is reopened by the reconciliation primitive.
    perform public.reconcile_bank_transaction(tx.id,'undo');
    if tx.posting_kind='expense' then
      update public.expenses set archived_at=now() where id=tx.expense_id and recurrence='one_off' and not exists(select 1 from public.expense_settlements where expense_id=tx.expense_id);
    end if;
    if job is not null then
      -- Only cancel a synthetic, still untouched appointment. Preserve operational
      -- work, invoiced jobs and other payments, even when its bank credit disappears.
      update public.interventions j set status='cancelled' where j.id=job and j.invoice_id is null and j.status='completed'
        and coalesce(j.actual_duration_minutes,0)=0 and coalesce(j.planned_duration_minutes,0)=0
        and (to_jsonb(j)->>'updated_at' is not distinct from to_jsonb(j)->>'created_at')
        and not exists(select 1 from public.payments where intervention_id=job)
        and not exists(select 1 from public.intervention_workers where intervention_id=job);
    end if;
    update public.bank_transactions set posting_kind='repost',automated_at=null,automation_note='Correction bancaire prise en compte automatiquement.' where id=tx.id;
    quantity:=quantity+1;
  end loop;
  return quantity;
end $$;
revoke all on function public.repair_qonto_postings(uuid) from public,anon,authenticated;
grant execute on function public.repair_qonto_postings(uuid) to service_role;
