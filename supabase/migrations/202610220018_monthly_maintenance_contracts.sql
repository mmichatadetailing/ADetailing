-- Contrats d'entretien mensuel : une visite chaque mois, avec une facturation
-- mensuelle ou annuelle indépendante du rythme opérationnel.
create table if not exists public.maintenance_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  location_id uuid references public.locations(id),
  client_id uuid not null references public.clients(id),
  service_id uuid references public.services(id),
  title text not null,
  status text not null default 'active' check (status in ('active','paused','ended')),
  billing_frequency text not null check (billing_frequency in ('monthly','annual')),
  billing_amount_cents bigint not null check (billing_amount_cents > 0),
  vehicle_count integer not null default 1 check (vehicle_count between 1 and 1000),
  first_visit_on date not null,
  visit_day smallint not null check (visit_day between 1 and 28),
  preferred_start_time time not null default '09:00',
  planned_duration_minutes integer not null check (planned_duration_minutes between 15 and 1440),
  assigned_member_ids uuid[] not null check (cardinality(assigned_member_ids) between 1 and 12),
  address text not null default '',
  notes text not null default '',
  ends_on date,
  generated_through date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (ends_on is null or ends_on >= first_visit_on)
);

create index if not exists maintenance_contracts_org_status_idx
  on public.maintenance_contracts (organization_id, status, first_visit_on)
  where archived_at is null;

create table if not exists public.maintenance_billing_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  location_id uuid references public.locations(id),
  contract_id uuid not null references public.maintenance_contracts(id) on delete cascade,
  period_start date not null,
  due_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'due' check (status in ('due','paid','cancelled')),
  paid_at timestamptz,
  payment_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, period_start)
);

create index if not exists maintenance_billing_org_due_idx
  on public.maintenance_billing_periods (organization_id, status, due_on);

alter table public.interventions
  add column if not exists maintenance_contract_id uuid references public.maintenance_contracts(id) on delete set null,
  add column if not exists maintenance_period date;

create unique index if not exists interventions_maintenance_period_unique
  on public.interventions (maintenance_contract_id, maintenance_period)
  where maintenance_contract_id is not null and archived_at is null;

alter table public.payments
  drop constraint if exists payments_single_source_check;

alter table public.payments
  add column if not exists maintenance_contract_id uuid references public.maintenance_contracts(id) on delete set null,
  add column if not exists maintenance_billing_period_id uuid references public.maintenance_billing_periods(id) on delete cascade;

alter table public.payments
  add constraint payments_single_source_check
  check (num_nonnulls(invoice_id, intervention_id, maintenance_billing_period_id) = 1) not valid;

alter table public.payments validate constraint payments_single_source_check;

create unique index if not exists payments_maintenance_period_unique
  on public.payments (maintenance_billing_period_id)
  where maintenance_billing_period_id is not null;

alter table public.maintenance_contracts enable row level security;
alter table public.maintenance_billing_periods enable row level security;

create policy maintenance_contracts_org_select on public.maintenance_contracts
  for select to authenticated using (public.is_org_member(organization_id));
create policy maintenance_contracts_manager_insert on public.maintenance_contracts
  for insert to authenticated with check (public.has_permission(organization_id, 'business.manage'));
create policy maintenance_contracts_manager_update on public.maintenance_contracts
  for update to authenticated using (public.has_permission(organization_id, 'business.manage')) with check (public.has_permission(organization_id, 'business.manage'));

create policy maintenance_billing_finance_select on public.maintenance_billing_periods
  for select to authenticated using (public.has_permission(organization_id, 'finance.read'));
create policy maintenance_billing_manager_insert on public.maintenance_billing_periods
  for insert to authenticated with check (public.has_permission(organization_id, 'business.manage'));
create policy maintenance_billing_manager_update on public.maintenance_billing_periods
  for update to authenticated using (public.has_permission(organization_id, 'business.manage')) with check (public.has_permission(organization_id, 'business.manage'));

create trigger maintenance_contracts_touch_updated_at
  before update on public.maintenance_contracts
  for each row execute function public.touch_updated_at();
create trigger maintenance_billing_touch_updated_at
  before update on public.maintenance_billing_periods
  for each row execute function public.touch_updated_at();

create trigger maintenance_contracts_audit
  after insert or update or delete on public.maintenance_contracts
  for each row execute function public.audit_sensitive_change();
create trigger maintenance_billing_audit
  after insert or update or delete on public.maintenance_billing_periods
  for each row execute function public.audit_sensitive_change();

grant select, insert, update on public.maintenance_contracts to authenticated;
grant select, insert, update on public.maintenance_billing_periods to authenticated;

create or replace function public.generate_maintenance_schedule(target_contract uuid, target_through date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_record public.maintenance_contracts%rowtype;
  month_cursor date;
  visit_date date;
  visit_start timestamptz;
  generated_intervention_id uuid;
  assigned_id uuid;
  member_record record;
  product_cost bigint := 0;
  travel_cost bigint := 0;
  recognized_revenue bigint;
  annual_revenue_base bigint;
  annual_revenue_remainder integer;
  month_index integer := 0;
  generated_count integer := 0;
begin
  select * into contract_record
  from public.maintenance_contracts
  where id = target_contract and archived_at is null
  for update;

  if not found then raise exception 'Contrat d’entretien introuvable.'; end if;
  if not public.has_permission(contract_record.organization_id, 'business.manage') then
    raise exception 'Cette action est réservée aux administrateurs et associés.';
  end if;
  if target_through < contract_record.first_visit_on then
    raise exception 'La fin de planification précède la première visite.';
  end if;
  if target_through > current_date + interval '36 months' then
    raise exception 'La planification est limitée à 36 mois.';
  end if;
  if contract_record.status <> 'active' then return 0; end if;

  if contract_record.service_id is not null then
    select target_product_cost_cents, target_travel_cost_cents
      into product_cost, travel_cost
    from public.services
    where id = contract_record.service_id and organization_id = contract_record.organization_id;
  end if;

  annual_revenue_base := contract_record.billing_amount_cents / 12;
  annual_revenue_remainder := mod(contract_record.billing_amount_cents, 12)::integer;

  month_cursor := date_trunc('month', contract_record.first_visit_on)::date;
  while month_cursor <= date_trunc('month', target_through)::date loop
    visit_date := make_date(
      extract(year from month_cursor)::integer,
      extract(month from month_cursor)::integer,
      least(contract_record.visit_day, extract(day from (month_cursor + interval '1 month - 1 day'))::integer)
    );

    if visit_date >= contract_record.first_visit_on
      and (contract_record.ends_on is null or visit_date <= contract_record.ends_on) then
      recognized_revenue := case
        when contract_record.billing_frequency = 'monthly' then contract_record.billing_amount_cents
        else annual_revenue_base + case when mod(month_index, 12) < annual_revenue_remainder then 1 else 0 end
      end;
      visit_start := ((visit_date::text || ' ' || contract_record.preferred_start_time::text)::timestamp at time zone 'Europe/Paris');

      select id into generated_intervention_id
      from public.interventions
      where maintenance_contract_id = contract_record.id
        and maintenance_period = month_cursor
        and archived_at is null
      limit 1;

      if generated_intervention_id is null then
        insert into public.interventions (
          organization_id, location_id, client_id, maintenance_contract_id, maintenance_period,
          status, title, start_at, end_at, planned_duration_minutes,
          product_cost_cents, travel_cost_cents, address, notes, created_by
        ) values (
          contract_record.organization_id, contract_record.location_id, contract_record.client_id,
          contract_record.id, month_cursor, 'scheduled', contract_record.title, visit_start,
          visit_start + make_interval(mins => contract_record.planned_duration_minutes),
          contract_record.planned_duration_minutes, product_cost, travel_cost,
          contract_record.address, 'Visite générée par le contrat d’entretien mensuel.', auth.uid()
        ) returning id into generated_intervention_id;
        generated_count := generated_count + 1;
      elsif exists (
        select 1 from public.interventions
        where id = generated_intervention_id and status in ('to_schedule','scheduled','confirmed')
      ) then
        update public.interventions set
          client_id = contract_record.client_id,
          title = contract_record.title,
          start_at = visit_start,
          end_at = visit_start + make_interval(mins => contract_record.planned_duration_minutes),
          planned_duration_minutes = contract_record.planned_duration_minutes,
          product_cost_cents = product_cost,
          travel_cost_cents = travel_cost,
          address = contract_record.address
        where id = generated_intervention_id;
        delete from public.intervention_workers where intervention_workers.intervention_id = generated_intervention_id;
        delete from public.intervention_items where intervention_items.intervention_id = generated_intervention_id;
      end if;

      if not exists (select 1 from public.intervention_items where intervention_items.intervention_id = generated_intervention_id) then
        insert into public.intervention_items (
          organization_id, intervention_id, service_id, label, quantity, revenue_allocated_cents
        ) values (
          contract_record.organization_id, generated_intervention_id, contract_record.service_id,
          contract_record.title, 1, recognized_revenue
        );
      end if;

      if not exists (select 1 from public.intervention_workers where intervention_workers.intervention_id = generated_intervention_id) then
        foreach assigned_id in array contract_record.assigned_member_ids loop
          select id, profile_id into member_record
          from public.organization_members
          where organization_id = contract_record.organization_id
            and active = true
            and (id = assigned_id or profile_id = assigned_id)
          limit 1;
          if member_record.id is null then raise exception 'Un collaborateur affecté est introuvable ou inactif.'; end if;
          insert into public.intervention_workers (
            organization_id, intervention_id, profile_id, pending_member_id, planned_minutes
          ) values (
            contract_record.organization_id, generated_intervention_id, member_record.profile_id,
            case when member_record.profile_id is null then member_record.id else null end,
            contract_record.planned_duration_minutes
          );
        end loop;
      end if;

      if contract_record.billing_frequency = 'monthly' or mod(month_index, 12) = 0 then
        insert into public.maintenance_billing_periods (
          organization_id, location_id, contract_id, period_start, due_on, amount_cents
        ) values (
          contract_record.organization_id, contract_record.location_id, contract_record.id,
          month_cursor, visit_date, contract_record.billing_amount_cents
        )
        on conflict (contract_id, period_start) do update set
          due_on = excluded.due_on,
          amount_cents = case when public.maintenance_billing_periods.status = 'paid' then public.maintenance_billing_periods.amount_cents else excluded.amount_cents end;
      end if;
    end if;

    month_cursor := (month_cursor + interval '1 month')::date;
    month_index := month_index + 1;
    generated_intervention_id := null;
  end loop;

  update public.maintenance_contracts
  set generated_through = greatest(coalesce(generated_through, target_through), target_through)
  where id = contract_record.id;

  return generated_count;
end;
$$;

revoke all on function public.generate_maintenance_schedule(uuid, date) from public, anon;
grant execute on function public.generate_maintenance_schedule(uuid, date) to authenticated;

create or replace function public.refresh_maintenance_schedule(target_contract uuid, target_through date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_org uuid;
begin
  select organization_id into contract_org
  from public.maintenance_contracts
  where id = target_contract and archived_at is null;
  if contract_org is null then raise exception 'Contrat d’entretien introuvable.'; end if;
  if not public.has_permission(contract_org, 'business.manage') then
    raise exception 'Cette action est réservée aux administrateurs et associés.';
  end if;

  update public.interventions
  set archived_at = now()
  where maintenance_contract_id = target_contract
    and archived_at is null
    and start_at::date >= current_date
    and status in ('to_schedule','scheduled','confirmed');

  delete from public.maintenance_billing_periods
  where contract_id = target_contract
    and status <> 'paid'
    and due_on >= current_date;

  return public.generate_maintenance_schedule(target_contract, target_through);
end;
$$;

revoke all on function public.refresh_maintenance_schedule(uuid, date) from public, anon;
grant execute on function public.refresh_maintenance_schedule(uuid, date) to authenticated;

create or replace function public.set_maintenance_billing_paid(
  target_period uuid,
  mark_paid boolean,
  payment_date timestamptz default now(),
  payment_method_name text default 'Virement'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  billing_record public.maintenance_billing_periods%rowtype;
  payment_id uuid;
begin
  select * into billing_record
  from public.maintenance_billing_periods
  where id = target_period
  for update;

  if not found then raise exception 'Échéance introuvable.'; end if;
  if not public.has_permission(billing_record.organization_id, 'business.manage') then
    raise exception 'Cette action est réservée aux administrateurs et associés.';
  end if;

  if mark_paid then
    insert into public.payments (
      organization_id, location_id, maintenance_contract_id, maintenance_billing_period_id,
      amount_cents, paid_at, method, created_by
    ) values (
      billing_record.organization_id, billing_record.location_id, billing_record.contract_id,
      billing_record.id, billing_record.amount_cents, payment_date, payment_method_name, auth.uid()
    )
    on conflict (maintenance_billing_period_id) do update set
      amount_cents = excluded.amount_cents,
      paid_at = excluded.paid_at,
      method = excluded.method,
      updated_at = now()
    returning id into payment_id;

    update public.maintenance_billing_periods set
      status = 'paid', paid_at = payment_date, payment_method = payment_method_name
    where id = billing_record.id;
  else
    delete from public.payments where maintenance_billing_period_id = billing_record.id;
    update public.maintenance_billing_periods set
      status = 'due', paid_at = null, payment_method = null
    where id = billing_record.id;
    payment_id := null;
  end if;

  return payment_id;
end;
$$;

revoke all on function public.set_maintenance_billing_paid(uuid, boolean, timestamptz, text) from public, anon;
grant execute on function public.set_maintenance_billing_paid(uuid, boolean, timestamptz, text) to authenticated;

