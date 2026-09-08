-- Les jetons OAuth restent strictement privés. Seule une projection des événements
-- utiles au planning est partagée avec les associés et administrateurs de l’entreprise.
create table if not exists public.google_calendar_shared_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid not null references public.google_calendar_connections(id) on delete cascade,
  google_calendar_id text not null,
  google_event_id text not null,
  calendar_name text not null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  busy boolean not null default true,
  color text,
  location_label text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_shared_events_period_check check (ends_at > starts_at),
  constraint google_calendar_shared_events_source_key unique (connection_id, google_calendar_id, google_event_id)
);

create index if not exists google_calendar_shared_events_org_period_idx
  on public.google_calendar_shared_events (organization_id, starts_at, ends_at);
create index if not exists google_calendar_shared_events_owner_period_idx
  on public.google_calendar_shared_events (owner_profile_id, starts_at, ends_at);

create or replace function public.can_view_team_google_events(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = target_org
      and membership.profile_id = auth.uid()
      and membership.active
      and membership.role in ('admin', 'partner')
  );
$$;

revoke all on function public.can_view_team_google_events(uuid) from public;
grant execute on function public.can_view_team_google_events(uuid) to authenticated;

alter table public.google_calendar_shared_events enable row level security;

create policy google_calendar_shared_events_select on public.google_calendar_shared_events
  for select to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.can_view_team_google_events(organization_id)
  );

create policy google_calendar_shared_events_insert on public.google_calendar_shared_events
  for insert to authenticated
  with check (
    owner_profile_id = auth.uid()
    and public.is_org_member(organization_id)
    and exists (
      select 1 from public.google_calendar_connections connection
      where connection.id = connection_id
        and connection.organization_id = google_calendar_shared_events.organization_id
        and connection.profile_id = auth.uid()
    )
  );

create policy google_calendar_shared_events_update on public.google_calendar_shared_events
  for update to authenticated
  using (owner_profile_id = auth.uid() and public.is_org_member(organization_id))
  with check (
    owner_profile_id = auth.uid()
    and public.is_org_member(organization_id)
    and exists (
      select 1 from public.google_calendar_connections connection
      where connection.id = connection_id
        and connection.organization_id = google_calendar_shared_events.organization_id
        and connection.profile_id = auth.uid()
    )
  );

create policy google_calendar_shared_events_delete on public.google_calendar_shared_events
  for delete to authenticated
  using (owner_profile_id = auth.uid() and public.is_org_member(organization_id));

revoke all on table public.google_calendar_shared_events from anon;
grant select, insert, update, delete on table public.google_calendar_shared_events to authenticated;

drop trigger if exists google_calendar_shared_events_touch_updated_at on public.google_calendar_shared_events;
create trigger google_calendar_shared_events_touch_updated_at
  before update on public.google_calendar_shared_events
  for each row execute function public.touch_updated_at();
