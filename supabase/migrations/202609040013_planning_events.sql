-- Événements internes du planning, distincts des prestations commerciales.
create table if not exists public.planning_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  location_id uuid references public.locations(id),
  kind text not null check (kind in ('meeting', 'unavailability', 'absence', 'personal')),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  member_ids uuid[] not null default '{}'::uuid[],
  location_label text,
  notes text,
  color text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (ends_at > starts_at),
  check (cardinality(member_ids) > 0)
);

create index if not exists planning_events_org_period_idx
  on public.planning_events (organization_id, starts_at, ends_at)
  where archived_at is null;
create index if not exists planning_events_member_ids_idx
  on public.planning_events using gin (member_ids);

alter table public.planning_events enable row level security;

create or replace function public.planning_event_members_are_valid(target_org uuid, target_members uuid[])
returns boolean language sql stable security definer set search_path = public
as $$
  select cardinality(target_members) > 0 and not exists (
    select 1
    from unnest(target_members) as selected(member_id)
    where not exists (
      select 1
      from public.organization_members member
      where member.organization_id = target_org
        and member.active
        and (member.profile_id = selected.member_id or (member.profile_id is null and member.id = selected.member_id))
    )
  );
$$;

create or replace function public.can_manage_planning_event(target_org uuid, target_members uuid[])
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = target_org
      and member.profile_id = auth.uid()
      and member.active
      and (
        member.role in ('admin', 'partner')
        or (cardinality(target_members) = 1 and target_members[1] = auth.uid())
      )
  );
$$;

revoke all on function public.planning_event_members_are_valid(uuid, uuid[]) from public;
revoke all on function public.can_manage_planning_event(uuid, uuid[]) from public;
grant execute on function public.planning_event_members_are_valid(uuid, uuid[]) to authenticated;
grant execute on function public.can_manage_planning_event(uuid, uuid[]) to authenticated;

create policy planning_events_org_select on public.planning_events
  for select to authenticated
  using (public.is_org_member(organization_id));
create policy planning_events_org_insert on public.planning_events
  for insert to authenticated
  with check (
    public.can_manage_planning_event(organization_id, member_ids)
    and public.planning_event_members_are_valid(organization_id, member_ids)
  );
create policy planning_events_org_update on public.planning_events
  for update to authenticated
  using (public.can_manage_planning_event(organization_id, member_ids))
  with check (
    public.can_manage_planning_event(organization_id, member_ids)
    and public.planning_event_members_are_valid(organization_id, member_ids)
  );

create trigger planning_events_touch_updated_at
  before update on public.planning_events
  for each row execute function public.touch_updated_at();

grant select, insert, update on public.planning_events to authenticated;
