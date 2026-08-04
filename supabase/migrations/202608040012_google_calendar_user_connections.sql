-- Une connexion Google appartient uniquement au membre qui l’a autorisée.
drop policy if exists google_calendar_connections_org_select on public.google_calendar_connections;
drop policy if exists google_calendar_connections_org_insert on public.google_calendar_connections;
drop policy if exists google_calendar_connections_org_update on public.google_calendar_connections;

create policy google_calendar_connections_self_select on public.google_calendar_connections
  for select to authenticated
  using (profile_id = auth.uid() and public.is_org_member(organization_id));

create policy google_calendar_connections_self_insert on public.google_calendar_connections
  for insert to authenticated
  with check (profile_id = auth.uid() and public.is_org_member(organization_id));

create policy google_calendar_connections_self_update on public.google_calendar_connections
  for update to authenticated
  using (profile_id = auth.uid() and public.is_org_member(organization_id))
  with check (profile_id = auth.uid() and public.is_org_member(organization_id));

create policy google_calendar_connections_self_delete on public.google_calendar_connections
  for delete to authenticated
  using (profile_id = auth.uid() and public.is_org_member(organization_id));

-- Les correspondances d’événements suivent le propriétaire de la connexion.
drop policy if exists calendar_event_mappings_org_select on public.calendar_event_mappings;
drop policy if exists calendar_event_mappings_org_insert on public.calendar_event_mappings;
drop policy if exists calendar_event_mappings_org_update on public.calendar_event_mappings;

create policy calendar_event_mappings_self_select on public.calendar_event_mappings
  for select to authenticated
  using (exists (
    select 1 from public.google_calendar_connections connection
    where connection.id = connection_id and connection.profile_id = auth.uid()
  ));

create policy calendar_event_mappings_self_insert on public.calendar_event_mappings
  for insert to authenticated
  with check (exists (
    select 1 from public.google_calendar_connections connection
    where connection.id = connection_id
      and connection.profile_id = auth.uid()
      and connection.organization_id = calendar_event_mappings.organization_id
  ));

create policy calendar_event_mappings_self_update on public.calendar_event_mappings
  for update to authenticated
  using (exists (
    select 1 from public.google_calendar_connections connection
    where connection.id = connection_id and connection.profile_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.google_calendar_connections connection
    where connection.id = connection_id
      and connection.profile_id = auth.uid()
      and connection.organization_id = calendar_event_mappings.organization_id
  ));

create policy calendar_event_mappings_self_delete on public.calendar_event_mappings
  for delete to authenticated
  using (exists (
    select 1 from public.google_calendar_connections connection
    where connection.id = connection_id and connection.profile_id = auth.uid()
  ));

alter table public.calendar_event_mappings
  add constraint calendar_event_mappings_intervention_calendar_key
  unique (connection_id, intervention_id, google_calendar_id);

create index if not exists calendar_event_mappings_intervention_idx
  on public.calendar_event_mappings (intervention_id, connection_id);
