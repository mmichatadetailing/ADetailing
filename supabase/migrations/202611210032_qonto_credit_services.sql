-- Qonto exposes attachment_ids on the transaction itself. Keep only a count:
-- NULL = not checked, 0 = checked and empty. No document, URL or bank credential is stored here.
alter table public.bank_transactions
  add column attachment_count integer check (attachment_count >= 0),
  add column service_declared_by uuid references public.profiles(id),
  add column declared_service_client_id uuid references public.clients(id),
  add column declared_service_title text;
alter table public.clients add column qonto_unidentified boolean not null default false;
create unique index clients_one_unidentified_qonto on public.clients(organization_id) where qonto_unidentified and archived_at is null;
alter table public.qonto_connections add column attachment_replay_required boolean not null default false;
update public.qonto_connections c set attachment_replay_required=true where exists
  (select 1 from public.bank_transactions t where t.organization_id=c.organization_id and t.side='credit');

-- Keep the original monotonic upsert and its correction triggers; transaction
-- data and its attachment count commit together, including on pagination retries.
alter function public.ingest_qonto_transactions(uuid,jsonb) rename to ingest_qonto_movements;
revoke all on function public.ingest_qonto_movements(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.ingest_qonto_transactions(target_org uuid, entries jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.ingest_qonto_movements(target_org,entries);
  update public.bank_transactions t set attachment_count=e.attachment_count
    from jsonb_to_recordset(entries) e(remote_id text,remote_organization_id text,remote_updated_at timestamptz,attachment_count integer)
    where t.organization_id=target_org and t.remote_organization_id=e.remote_organization_id and t.remote_id=e.remote_id
      and t.remote_updated_at=e.remote_updated_at and t.side='credit' and e.attachment_count is not null
      and t.attachment_count is distinct from e.attachment_count;
end $$;
revoke all on function public.ingest_qonto_transactions(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_qonto_transactions(uuid,jsonb) to service_role;

-- Only the server supplies a verified decision after scanning this company's
-- ledger. The amount, date, tenant and source stay authoritative under the same
-- transaction/connection locks used by ordinary postings. The manual action is
-- deliberately narrow: it cannot change a debit, a group or an exclusion.
create function public.register_qonto_service_credit(target_org uuid,target_transaction uuid,expected_amount bigint,
  expected_settled_at timestamptz,expected_version timestamptz,decision jsonb,actor_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  t public.bank_transactions%rowtype; c public.qonto_connections%rowtype; d public.bank_transaction_drafts%rowtype;
  p public.payments%rowtype; customer uuid; candidates uuid[]; job uuid; job_title text;
  client_name text:=nullif(trim(decision->>'clientName'),''); kind text; note text; bank_words text;
  unidentified boolean:=coalesce((decision->>'unidentified')::boolean,false);
begin
  if actor_id is not null and not exists(select 1 from public.organization_members m where m.organization_id=target_org
    and m.profile_id=actor_id and m.active and m.role in ('admin','partner')) then raise exception 'Action réservée aux associés et administrateurs.'; end if;
  select * into t from public.bank_transactions where organization_id=target_org and id=target_transaction for update;
  if not found then raise exception 'Transaction introuvable dans cette entreprise.'; end if;
  select * into strict c from public.qonto_connections where organization_id=target_org for update;
  if t.amount_cents is distinct from expected_amount or t.settled_at is distinct from expected_settled_at
    or t.remote_updated_at is distinct from expected_version then raise exception 'Le mouvement a changé. Actualisez le journal.'; end if;
  if t.side<>'credit' or t.status<>'completed' or t.currency<>'EUR' or t.amount_cents<=0 or t.settled_at is null or t.settled_at>now()
    or t.reconciliation_group_id is not null or t.reconciliation in ('ignored','review') then return jsonb_build_object('skipped',true); end if;
  if t.reconciliation='matched' and t.payment_id is not null then
    select * into strict p from public.payments where id=t.payment_id and organization_id=target_org;
    select j.id into job from public.interventions j where j.organization_id=target_org and j.archived_at is null
      and (j.id=p.intervention_id or j.invoice_id=p.invoice_id) order by j.id limit 1;
    return jsonb_build_object('kind','existing','interventionId',job);
  end if;
  if t.reconciliation<>'unmatched' or t.automated_at is not null or t.payment_id is not null or t.expense_id is not null then return jsonb_build_object('skipped',true); end if;
  bank_words:=public.qonto_identity(concat_ws(' ',t.operation_type,t.counterparty,t.label,t.reference));
  if t.operation_type in ('internal_transfer','account_remuneration','atm','withdrawal','card')
    or bank_words ~ '\m(virement interne|virement de compte a compte|transfert entre (nos|mes) comptes|apport|capital social|augmentation de capital|emprunt|pret|loan|dividendes?|retrait|withdrawal|compte courant (d |des )?associes?|remboursements?|refund|cashback|avoir fournisseur|avoir client|salaire|salary)\M'
    then return jsonb_build_object('skipped',true); end if;
  select * into d from public.bank_transaction_drafts where bank_transaction_id=t.id for update;
  if found and (d.status<>'pending' or d.updated_at<>d.created_at) then return jsonb_build_object('skipped',true); end if;
  if actor_id is null and (not c.enabled or (t.service_declared_by is null and
    (coalesce(t.attachment_count,0)=0 or (t.settled_at<c.posting_from and d.id is null)
      or (t.settled_at at time zone 'Europe/Paris')::date < date '2026-06-24'))) then return jsonb_build_object('skipped',true); end if;
  -- The decision is recomputed server-side, never supplied by the browser.
  if decision->>'action'='match' and decision->>'kind' in ('intervention','payment','invoice','maintenance') then
    if decision->>'kind'='payment' then
      select * into strict p from public.payments where id=(decision->>'id')::uuid and organization_id=target_org for update;
      if public.qonto_identity(p.method) ~ '^(en )?(especes?|liquides?|cash)$' then raise exception 'Un règlement en espèces ne peut pas être rapproché de la banque.'; end if;
    end if;
    perform public.reconcile_bank_transaction(t.id,decision->>'kind',(decision->>'id')::uuid);
    kind:='matched'; note:='Règlement rattaché à une écriture existante, sans nouvel encaissement en double.';
  elsif decision->>'action'='service' then
    customer:=nullif(decision->>'clientId','')::uuid;
    if customer is not null then
      select id into customer from public.clients where id=customer and organization_id=target_org and archived_at is null for update;
      if not found then raise exception 'Client introuvable dans cette entreprise.'; end if;
    elsif unidentified then
      select id into customer from public.clients where organization_id=target_org and qonto_unidentified and archived_at is null for update;
    else
      if client_name is null or length(client_name)>300 or length(public.qonto_identity(client_name))<2 then raise exception 'Nom du client invalide.'; end if;
      select array_agg(id) into candidates from public.clients where organization_id=target_org and archived_at is null and not qonto_unidentified and public.qonto_identity(client_name)
        in (public.qonto_identity(company),public.qonto_identity(first_name||' '||last_name),public.qonto_identity(last_name||' '||first_name));
      if cardinality(candidates)>1 then return jsonb_build_object('kind','bank_only','reason','Plusieurs clients portent ce nom. Sélectionnez la bonne fiche.'); end if;
      customer:=candidates[1];
      if customer is not null then
        perform 1 from public.clients where id=customer and organization_id=target_org and archived_at is null for update;
        if not found then raise exception 'La fiche client a changé. Actualisez le journal.'; end if;
      end if;
    end if;
    -- Recheck live balances under lock: a competing posting or an unlinked
    -- manually booked receipt must not turn into a second sale.
    if exists(select 1 from public.payments paid left join public.interventions j on j.id=paid.intervention_id
        left join public.invoices i on i.id=paid.invoice_id left join public.maintenance_contracts m on m.id=paid.maintenance_contract_id
      where paid.organization_id=target_org and paid.amount_cents=t.amount_cents and public.qonto_identity(paid.method) !~ '^(en )?(especes?|liquides?|cash)$'
        and (paid.reference=t.remote_id or (abs(extract(epoch from paid.paid_at-t.settled_at))<=7*86400
          and (unidentified or customer=coalesce(j.client_id,i.client_id,m.client_id))))
        and not exists(select 1 from public.bank_transactions b where b.payment_id=paid.id)
        and not exists(select 1 from public.bank_reconciliation_groups g where g.payment_id=paid.id))
      or exists(select 1 from public.interventions j where j.organization_id=target_org and j.client_id=customer and j.archived_at is null and j.status<>'cancelled'
        and (j.status<>'completed' or (abs(extract(epoch from j.start_at-t.settled_at))<=7*86400 and
          (select coalesce(sum(i.revenue_allocated_cents),0) from public.intervention_items i where i.intervention_id=j.id)>
          (select coalesce(sum(v.amount_cents),0) from public.payments v where v.intervention_id=j.id or v.invoice_id=j.invoice_id))))
      or exists(select 1 from public.maintenance_contracts m join public.maintenance_billing_periods b on b.contract_id=m.id
        where m.organization_id=target_org and m.client_id=customer and m.archived_at is null and b.status='due')
      or exists(select 1 from public.invoices i where i.organization_id=target_org and i.client_id=customer and i.archived_at is null and i.status not in ('cancelled','credit_note','paid')
        and i.total_including_tax_cents>(select coalesce(sum(v.amount_cents),0) from public.payments v where v.invoice_id=i.id or v.intervention_id in(select j.id from public.interventions j where j.invoice_id=i.id))) then
      note:='Un dossier ou un paiement peut déjà correspondre à ce crédit. Aucune nouvelle prestation créée.';
      update public.bank_transactions set posting_kind='bank_only',automation_note=note where id=t.id;
      return jsonb_build_object('kind','bank_only','reason',note);
    end if;
    if customer is null then
      insert into public.clients(organization_id,location_id,kind,last_name,notes,qonto_unidentified)
        values(target_org,c.location_id,'individual',case when unidentified then 'Client à identifier (Qonto)' else client_name end,
          case when unidentified then 'Fiche commune pour les prestations dont le payeur n’est pas encore identifié.' else 'Fiche créée depuis un encaissement Qonto.' end,unidentified)
        returning id into customer;
    end if;
    job_title:=left(coalesce(nullif(trim(decision->>'title'),''),t.declared_service_title,nullif(trim(t.label),''),'Prestation Qonto'),160);
    insert into public.interventions(organization_id,location_id,client_id,title,status,start_at,planned_duration_minutes,notes,created_by)
      values(target_org,c.location_id,customer,job_title,'completed',t.settled_at,0,'Prestation enregistrée depuis le journal Qonto.',actor_id) returning id into job;
    insert into public.intervention_items(organization_id,intervention_id,label,quantity,revenue_allocated_cents) values(target_org,job,job_title,1,t.amount_cents);
    perform public.reconcile_bank_transaction(t.id,'intervention',job);
    kind:='service'; note:=case when actor_id is not null or t.service_declared_by is not null then 'Prestation déclarée et encaissée à la date bancaire.' else 'Prestation terminée et encaissée : justificatif Qonto lié.' end;
  else raise exception 'Affectation du crédit incompatible.'; end if;
  update public.bank_transactions set posting_kind=kind,automated_at=now(),automation_note=note,
    reconciled_by=coalesce(actor_id,reconciled_by),service_declared_by=coalesce(actor_id,service_declared_by),
    declared_service_client_id=case when actor_id is not null then customer else declared_service_client_id end,
    declared_service_title=case when actor_id is not null then job_title else declared_service_title end where id=t.id;
  if job is null then
    select j.id into job from public.bank_transactions b join public.payments v on v.id=b.payment_id
      join public.interventions j on j.organization_id=b.organization_id and (j.id=v.intervention_id or j.invoice_id=v.invoice_id)
      where b.id=t.id and j.archived_at is null order by j.id limit 1;
  end if;
  -- The original reconciliation primitive assumes a transfer. A newly booked
  -- cheque or other documented credit must not be mislabeled as a transfer.
  -- Never overwrite the method of a payment already entered by a person.
  if t.operation_type not in ('transfer','income') then
    update public.payments v set method=case when t.operation_type in ('check','cheque') then 'Chèque Qonto' else 'Encaissement Qonto' end
      from public.bank_transactions b where b.id=t.id and b.created_entry and v.id=b.payment_id returning v.* into p;
    if found and p.maintenance_billing_period_id is not null then
      update public.maintenance_billing_periods set payment_method=p.method where id=p.maintenance_billing_period_id and organization_id=target_org;
    end if;
  end if;
  return jsonb_build_object('kind',kind,'interventionId',job);
end $$;
revoke all on function public.register_qonto_service_credit(uuid,uuid,bigint,timestamptz,timestamptz,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.register_qonto_service_credit(uuid,uuid,bigint,timestamptz,timestamptz,jsonb,uuid) to service_role;
