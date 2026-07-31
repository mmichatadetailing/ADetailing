-- Comptes d'équipe, invitations et conversations privées.

alter table public.profiles
  add column if not exists current_organization_id uuid references public.organizations(id) on delete set null;

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.member_role not null default 'employee',
  location_id uuid references public.locations(id) on delete set null,
  weekly_capacity_minutes integer not null default 2100 check (weekly_capacity_minutes between 60 and 4800),
  color text not null default '#a78bfa',
  token_hash text not null unique,
  invited_by uuid not null references public.profiles(id),
  accepted_by uuid references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role <> 'admin'),
  check (email = lower(trim(email)))
);

create index if not exists organization_invitations_org_idx
  on public.organization_invitations (organization_id, created_at desc);
create index if not exists organization_invitations_email_idx
  on public.organization_invitations (lower(email));

alter table public.organization_invitations enable row level security;

create policy organization_invitations_manager_select on public.organization_invitations
  for select to authenticated
  using (public.has_permission(organization_id, 'team.manage'));
create policy organization_invitations_manager_insert on public.organization_invitations
  for insert to authenticated
  with check (
    public.has_permission(organization_id, 'team.manage')
    and invited_by = auth.uid()
  );
create policy organization_invitations_manager_update on public.organization_invitations
  for update to authenticated
  using (public.has_permission(organization_id, 'team.manage'))
  with check (public.has_permission(organization_id, 'team.manage'));

create trigger organization_invitations_touch_updated_at
  before update on public.organization_invitations
  for each row execute function public.touch_updated_at();

grant select, insert, update on public.organization_invitations to authenticated;

-- Retourne uniquement le contexte nécessaire à l'écran d'inscription. Le jeton
-- aléatoire est le secret d'accès et n'est jamais stocké en clair.
create or replace function public.get_organization_invitation(invitation_token text)
returns table (
  organization_name text,
  invited_email text,
  invited_role public.member_role,
  expires_at timestamptz,
  invitation_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.name,
    i.email,
    i.role,
    i.expires_at,
    case
      when i.revoked_at is not null then 'revoked'
      when i.accepted_at is not null then 'accepted'
      when i.expires_at <= now() then 'expired'
      else 'pending'
    end
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token_hash = encode(extensions.digest(invitation_token, 'sha256'), 'hex')
  limit 1;
$$;

revoke all on function public.get_organization_invitation(text) from public;
grant execute on function public.get_organization_invitation(text) to anon, authenticated;

-- Fonction interne utilisée aussi par le trigger Auth. Elle garantit que le
-- compte connecté correspond bien à l'adresse invitée.
create or replace function public.accept_organization_invitation_for_user(
  invitation_token text,
  target_user_id uuid,
  target_email text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation_record public.organization_invitations%rowtype;
begin
  select * into invitation_record
  from public.organization_invitations
  where token_hash = encode(extensions.digest(invitation_token, 'sha256'), 'hex')
  for update;

  if invitation_record.id is null then
    raise exception 'Invitation introuvable';
  end if;
  if invitation_record.revoked_at is not null then
    raise exception 'Cette invitation a été révoquée';
  end if;
  if invitation_record.expires_at <= now() then
    raise exception 'Cette invitation a expiré';
  end if;
  if lower(trim(coalesce(target_email, ''))) <> invitation_record.email then
    raise exception 'Cette invitation est destinée à une autre adresse e-mail';
  end if;
  if invitation_record.accepted_at is not null and invitation_record.accepted_by <> target_user_id then
    raise exception 'Cette invitation a déjà été utilisée';
  end if;

  insert into public.organization_members (
    organization_id,
    profile_id,
    role,
    location_id,
    active,
    weekly_capacity_minutes,
    color
  ) values (
    invitation_record.organization_id,
    target_user_id,
    invitation_record.role,
    invitation_record.location_id,
    true,
    invitation_record.weekly_capacity_minutes,
    invitation_record.color
  )
  on conflict (organization_id, profile_id) do update set
    role = excluded.role,
    location_id = coalesce(excluded.location_id, public.organization_members.location_id),
    active = true,
    weekly_capacity_minutes = excluded.weekly_capacity_minutes,
    color = excluded.color;

  update public.profiles
  set current_organization_id = invitation_record.organization_id
  where id = target_user_id;

  insert into public.conversation_members (organization_id, conversation_id, profile_id)
  select c.organization_id, c.id, target_user_id
  from public.conversations c
  where c.organization_id = invitation_record.organization_id and c.kind = 'general'
  on conflict (conversation_id, profile_id) do nothing;

  update public.organization_invitations
  set accepted_at = coalesce(accepted_at, now()), accepted_by = target_user_id
  where id = invitation_record.id;

  return invitation_record.organization_id;
end;
$$;

revoke all on function public.accept_organization_invitation_for_user(text, uuid, text) from public, anon, authenticated;

create or replace function public.accept_organization_invitation(invitation_token text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_email text;
begin
  if auth.uid() is null then
    raise exception 'Utilisateur non authentifié';
  end if;
  select email into current_email from auth.users where id = auth.uid();
  return public.accept_organization_invitation_for_user(invitation_token, auth.uid(), current_email);
end;
$$;

revoke all on function public.accept_organization_invitation(text) from public;
grant execute on function public.accept_organization_invitation(text) to authenticated;

create or replace function public.set_current_organization(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(target_organization_id) then
    raise exception 'Vous ne faites pas partie de cette entreprise';
  end if;
  update public.profiles
  set current_organization_id = target_organization_id
  where id = auth.uid();
end;
$$;

revoke all on function public.set_current_organization(uuid) from public;
grant execute on function public.set_current_organization(uuid) to authenticated;

create or replace function public.default_current_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set current_organization_id = new.organization_id
  where id = new.profile_id and current_organization_id is null;
  return new;
end;
$$;

drop trigger if exists organization_members_default_current on public.organization_members;
create trigger organization_members_default_current
  after insert on public.organization_members
  for each row execute function public.default_current_organization();

update public.profiles p
set current_organization_id = (
  select m.organization_id
  from public.organization_members m
  where m.profile_id = p.id and m.active
  order by m.created_at
  limit 1
)
where p.current_organization_id is null
  and exists (
    select 1 from public.organization_members m
    where m.profile_id = p.id and m.active
  );

-- Une inscription provenant d'une invitation rejoint directement l'entreprise
-- ciblée au lieu de créer un second espace vide.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation_token text;
begin
  invitation_token := nullif(trim(coalesce(new.raw_user_meta_data ->> 'invitation_token', '')), '');

  if invitation_token is null then
    perform public.provision_user_workspace(
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data, '{}'::jsonb)
    );
    return new;
  end if;

  insert into public.profiles (id, first_name, last_name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''), 'Utilisateur'),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'last_name'), ''), ''),
    lower(new.email)
  )
  on conflict (id) do update set
    email = excluded.email,
    first_name = excluded.first_name,
    last_name = excluded.last_name;

  perform public.accept_organization_invitation_for_user(invitation_token, new.id, new.email);
  return new;
end;
$$;

create or replace function public.sync_auth_user_email() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.sync_auth_user_email();

revoke all on function public.sync_auth_user_email() from public, anon, authenticated;

-- Tous les membres voient les mêmes chiffres de l'entreprise. Les restrictions
-- portent sur les actions d'administration, pas sur la lecture du pilotage.
drop policy if exists expenses_finance_select on public.expenses;
drop policy if exists payments_finance_select on public.payments;
drop policy if exists assets_finance_select on public.assets;
drop policy if exists objectives_finance_select on public.monthly_objectives;
create policy expenses_org_select on public.expenses for select to authenticated using (public.is_org_member(organization_id));
create policy payments_org_select on public.payments for select to authenticated using (public.is_org_member(organization_id));
create policy assets_org_select on public.assets for select to authenticated using (public.is_org_member(organization_id));
create policy monthly_objectives_org_select on public.monthly_objectives for select to authenticated using (public.is_org_member(organization_id));

-- Messagerie : le canal général est commun, les conversations liées à un
-- dossier ne sont visibles que par leurs participants.
create or replace function public.can_access_conversation(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = target_conversation_id
      and public.is_org_member(c.organization_id)
      and (
        c.kind = 'general'
        or exists (
          select 1 from public.conversation_members cm
          where cm.conversation_id = c.id and cm.profile_id = auth.uid()
        )
      )
  );
$$;

revoke all on function public.can_access_conversation(uuid) from public;
grant execute on function public.can_access_conversation(uuid) to authenticated;

drop policy if exists conversations_org_select on public.conversations;
drop policy if exists conversations_org_insert on public.conversations;
drop policy if exists conversations_org_update on public.conversations;
drop policy if exists conversation_members_org_select on public.conversation_members;
drop policy if exists conversation_members_org_insert on public.conversation_members;
drop policy if exists conversation_members_org_update on public.conversation_members;
drop policy if exists messages_org_select on public.messages;
drop policy if exists messages_org_insert on public.messages;
drop policy if exists messages_org_update on public.messages;

create policy conversations_participant_select on public.conversations
  for select to authenticated
  using (public.can_access_conversation(id));
create policy conversations_member_insert on public.conversations
  for insert to authenticated
  with check (public.is_org_member(organization_id) and created_by = auth.uid());
create policy conversations_creator_update on public.conversations
  for update to authenticated
  using (created_by = auth.uid() or public.has_permission(organization_id, 'team.manage'))
  with check (public.is_org_member(organization_id));

create policy conversation_members_participant_select on public.conversation_members
  for select to authenticated
  using (public.can_access_conversation(conversation_id));
create policy conversation_members_creator_insert on public.conversation_members
  for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (
      profile_id = auth.uid()
      or exists (
        select 1 from public.conversations c
        where c.id = conversation_id and c.created_by = auth.uid()
      )
      or public.has_permission(organization_id, 'team.manage')
    )
  );
create policy conversation_members_self_update on public.conversation_members
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy messages_participant_select on public.messages
  for select to authenticated
  using (public.can_access_conversation(conversation_id));
create policy messages_participant_insert on public.messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_access_conversation(conversation_id)
  );
create policy messages_author_update on public.messages
  for update to authenticated
  using (author_id = auth.uid() and public.can_access_conversation(conversation_id))
  with check (author_id = auth.uid() and public.can_access_conversation(conversation_id));

insert into public.conversation_members (organization_id, conversation_id, profile_id)
select c.organization_id, c.id, m.profile_id
from public.conversations c
join public.organization_members m on m.organization_id = c.organization_id and m.active
where c.kind = 'general'
on conflict (conversation_id, profile_id) do nothing;
