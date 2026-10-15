-- Les données restent lisibles par toute l'équipe, mais les écritures de
-- pilotage sont réservées aux administrateurs et associés.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'lead_sources','clients','vehicle_formats','vehicles','leads','lead_activities',
    'service_categories','service_checklist_templates','service_checklist_template_items','services','service_prices','service_aliases',
    'quotes','quote_items','invoices','invoice_items','payments','expenses','recurring_expense_rules','assets','monthly_objectives',
    'document_imports','document_import_fields','app_settings'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_org_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_org_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_manager_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_manager_update', table_name);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_permission(organization_id, ''business.manage''))',
      table_name || '_manager_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_permission(organization_id, ''business.manage'')) with check (public.has_permission(organization_id, ''business.manage''))',
      table_name || '_manager_update', table_name
    );
  end loop;
end $$;

create or replace function public.is_assigned_to_intervention(target_intervention uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.intervention_workers worker
    where worker.intervention_id = target_intervention
      and worker.profile_id = auth.uid()
  );
$$;
revoke all on function public.is_assigned_to_intervention(uuid) from public;
grant execute on function public.is_assigned_to_intervention(uuid) to authenticated;

create or replace function public.enforce_employee_intervention_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.has_permission(old.organization_id, 'business.manage') then
    return new;
  end if;
  if not public.is_assigned_to_intervention(old.id) then
    raise exception 'Cette prestation ne vous est pas affectée.';
  end if;
  if row(
    new.organization_id, new.location_id, new.client_id, new.vehicle_id, new.vehicle_format,
    new.quote_id, new.invoice_id, new.title, new.planned_duration_minutes,
    new.preparation_minutes, new.cleanup_minutes, new.address, new.latitude, new.longitude,
    new.deposit_amount_cents, new.notes, new.archived_at
  ) is distinct from row(
    old.organization_id, old.location_id, old.client_id, old.vehicle_id, old.vehicle_format,
    old.quote_id, old.invoice_id, old.title, old.planned_duration_minutes,
    old.preparation_minutes, old.cleanup_minutes, old.address, old.latitude, old.longitude,
    old.deposit_amount_cents, old.notes, old.archived_at
  ) then
    raise exception 'Un employé ne peut modifier que le suivi opérationnel de sa prestation.';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_employee_intervention_fields() from public, anon, authenticated;

drop trigger if exists interventions_employee_fields_guard on public.interventions;
create trigger interventions_employee_fields_guard
  before update on public.interventions
  for each row execute function public.enforce_employee_intervention_fields();

-- Un employé peut mettre à jour uniquement une prestation qui lui est affectée.
drop policy if exists interventions_org_update on public.interventions;
create policy interventions_assigned_update
  on public.interventions for update to authenticated
  using (
    public.has_permission(organization_id, 'business.manage')
    or public.is_assigned_to_intervention(id)
  )
  with check (
    public.has_permission(organization_id, 'business.manage')
    or public.is_assigned_to_intervention(id)
  );

drop policy if exists intervention_items_org_insert on public.intervention_items;
create policy intervention_items_assigned_insert on public.intervention_items
  for insert to authenticated
  with check (
    public.has_permission(organization_id, 'business.manage')
    or public.is_assigned_to_intervention(intervention_id)
  );

drop policy if exists intervention_items_org_update on public.intervention_items;
create policy intervention_items_manager_update on public.intervention_items
  for update to authenticated
  using (public.has_permission(organization_id, 'business.manage'))
  with check (public.has_permission(organization_id, 'business.manage'));

drop policy if exists intervention_items_org_delete on public.intervention_items;
create policy intervention_items_manager_delete on public.intervention_items
  for delete to authenticated
  using (public.has_permission(organization_id, 'business.manage'));

drop policy if exists service_prices_manager_delete on public.service_prices;
create policy service_prices_manager_delete on public.service_prices
  for delete to authenticated
  using (public.has_permission(organization_id, 'business.manage'));

drop policy if exists intervention_workers_org_delete on public.intervention_workers;
create policy intervention_workers_manager_delete on public.intervention_workers
  for delete to authenticated
  using (public.has_permission(organization_id, 'business.manage'));

drop policy if exists intervention_workers_org_insert on public.intervention_workers;
create policy intervention_workers_assigned_insert on public.intervention_workers
  for insert to authenticated
  with check (public.has_permission(organization_id, 'business.manage') or profile_id = auth.uid());

drop policy if exists intervention_workers_org_update on public.intervention_workers;
create policy intervention_workers_assigned_update on public.intervention_workers
  for update to authenticated
  using (
    public.has_permission(organization_id, 'business.manage')
    or public.is_assigned_to_intervention(intervention_id)
  )
  with check (
    public.has_permission(organization_id, 'business.manage')
    or public.is_assigned_to_intervention(intervention_id)
  );

drop policy if exists intervention_checklist_items_org_update on public.intervention_checklist_items;
create policy intervention_checklist_items_assigned_update on public.intervention_checklist_items
  for update to authenticated
  using (
    public.has_permission(organization_id, 'business.manage')
    or public.is_assigned_to_intervention(intervention_id)
  )
  with check (
    public.has_permission(organization_id, 'business.manage')
    or public.is_assigned_to_intervention(intervention_id)
  );

drop policy if exists payments_org_delete on public.payments;
create policy payments_manager_delete on public.payments
  for delete to authenticated
  using (public.has_permission(organization_id, 'business.manage'));
