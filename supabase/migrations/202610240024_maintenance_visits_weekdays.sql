-- Conserve le jour mensuel choisi comme ancre, mais reporte chaque occurrence
-- qui tombe un samedi ou un dimanche au lundi suivant. Les autres mois ne
-- sont pas décalés et gardent leur jour de référence initial.

create or replace function public.generate_maintenance_schedule(target_contract uuid, target_through date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_record public.maintenance_contracts%rowtype;
  month_cursor date;
  nominal_visit_date date;
  visit_date date;
  visit_start timestamptz;
  generated_intervention_id uuid;
  assigned_id uuid;
  member_record record;
  product_cost bigint := 0;
  travel_cost bigint := 0;
  recognized_revenue bigint;
  revenue_base bigint;
  revenue_remainder integer;
  recognition_months integer;
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

  recognition_months := case
    when contract_record.billing_frequency = 'monthly' then 1
    when contract_record.billing_frequency = 'prepaid' then contract_record.term_months
    else 12
  end;
  revenue_base := contract_record.billing_amount_cents / recognition_months;
  revenue_remainder := mod(contract_record.billing_amount_cents, recognition_months)::integer;

  month_cursor := date_trunc('month', contract_record.first_visit_on)::date;
  while month_cursor <= date_trunc('month', target_through)::date loop
    nominal_visit_date := make_date(
      extract(year from month_cursor)::integer,
      extract(month from month_cursor)::integer,
      least(contract_record.visit_day, extract(day from (month_cursor + interval '1 month - 1 day'))::integer)
    );
    visit_date := case extract(isodow from nominal_visit_date)::integer
      when 6 then nominal_visit_date + 2
      when 7 then nominal_visit_date + 1
      else nominal_visit_date
    end;

    if nominal_visit_date >= contract_record.first_visit_on
      and (contract_record.ends_on is null or nominal_visit_date <= contract_record.ends_on) then
      recognized_revenue := revenue_base + case when mod(month_index, recognition_months) < revenue_remainder then 1 else 0 end;
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
        where id = generated_intervention_id
          and start_at::date >= current_date
          and status in ('to_schedule','scheduled','confirmed')
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

      if contract_record.billing_frequency = 'monthly' or mod(month_index, recognition_months) = 0 then
        insert into public.maintenance_billing_periods (
          organization_id, location_id, contract_id, period_start, due_on, amount_cents
        ) values (
          contract_record.organization_id, contract_record.location_id, contract_record.id,
          month_cursor, visit_date, contract_record.billing_amount_cents
        )
        on conflict (contract_id, period_start) do update set
          due_on = case
            when public.maintenance_billing_periods.status = 'paid'
              or public.maintenance_billing_periods.due_on < current_date
            then public.maintenance_billing_periods.due_on
            else excluded.due_on
          end,
          amount_cents = case
            when public.maintenance_billing_periods.status = 'paid'
              or public.maintenance_billing_periods.due_on < current_date
            then public.maintenance_billing_periods.amount_cents
            else excluded.amount_cents
          end;
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
