-- Membres d'équipe préparés avant la création de leur compte.

alter table public.organization_members
  alter column profile_id drop not null,
  add column provisional_first_name text not null default '',
  add column provisional_last_name text not null default '',
  add column provisional_email text not null default '';

update public.organization_members m
set
  provisional_first_name = p.first_name,
  provisional_last_name = p.last_name,
  provisional_email = lower(coalesce(p.email, ''))
from public.profiles p
where p.id = m.profile_id;

alter table public.organization_members
  add constraint organization_members_identity_check check (
    profile_id is not null
    or (
      char_length(trim(provisional_first_name)) between 2 and 80
      and char_length(trim(provisional_last_name)) between 2 and 80
    )
  );

create unique index organization_members_pending_email_unique
  on public.organization_members (organization_id, lower(provisional_email))
  where profile_id is null and provisional_email <> '';

alter table public.organization_invitations
  add column pending_member_id uuid references public.organization_members(id) on delete set null;

create index organization_invitations_pending_member_idx
  on public.organization_invitations (pending_member_id, created_at desc);

alter table public.intervention_workers
  alter column profile_id drop not null,
  add column pending_member_id uuid references public.organization_members(id) on delete restrict;

alter table public.intervention_workers
  add constraint intervention_workers_identity_check check (
    (profile_id is not null and pending_member_id is null)
    or (profile_id is null and pending_member_id is not null)
  );

create unique index intervention_workers_pending_member_unique
  on public.intervention_workers (intervention_id, pending_member_id)
  where pending_member_id is not null;

-- Lors de l'acceptation, le membre préparé reçoit le compte et garde toutes ses affectations.
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
  pending_profile_id uuid;
  existing_member_id uuid;
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

  if invitation_record.pending_member_id is not null then
    select profile_id into pending_profile_id
    from public.organization_members
    where id = invitation_record.pending_member_id
      and organization_id = invitation_record.organization_id
    for update;

    if not found then
      raise exception 'Le membre préparé est introuvable';
    end if;
    if pending_profile_id is not null and pending_profile_id <> target_user_id then
      raise exception 'Ce membre est déjà associé à un autre compte';
    end if;

    select id into existing_member_id
    from public.organization_members
    where organization_id = invitation_record.organization_id
      and profile_id = target_user_id
    limit 1;

    if existing_member_id is not null and existing_member_id <> invitation_record.pending_member_id then
      delete from public.intervention_workers pending_worker
      using public.intervention_workers account_worker
      where pending_worker.pending_member_id = invitation_record.pending_member_id
        and account_worker.intervention_id = pending_worker.intervention_id
        and account_worker.profile_id = target_user_id;

      update public.intervention_workers
      set profile_id = target_user_id, pending_member_id = null
      where pending_member_id = invitation_record.pending_member_id;

      delete from public.organization_members
      where id = invitation_record.pending_member_id;

      update public.organization_members
      set
        role = invitation_record.role,
        location_id = coalesce(invitation_record.location_id, location_id),
        active = true,
        weekly_capacity_minutes = invitation_record.weekly_capacity_minutes,
        color = invitation_record.color
      where id = existing_member_id;
    else
      update public.intervention_workers
      set profile_id = target_user_id, pending_member_id = null
      where pending_member_id = invitation_record.pending_member_id;

      update public.organization_members
      set
        profile_id = target_user_id,
        role = invitation_record.role,
        location_id = coalesce(invitation_record.location_id, location_id),
        active = true,
        weekly_capacity_minutes = invitation_record.weekly_capacity_minutes,
        color = invitation_record.color,
        provisional_first_name = invitation_record.invited_first_name,
        provisional_last_name = invitation_record.invited_last_name,
        provisional_email = invitation_record.email
      where id = invitation_record.pending_member_id;
    end if;
  else
    insert into public.organization_members (
      organization_id,
      profile_id,
      role,
      location_id,
      active,
      weekly_capacity_minutes,
      color,
      provisional_first_name,
      provisional_last_name,
      provisional_email
    ) values (
      invitation_record.organization_id,
      target_user_id,
      invitation_record.role,
      invitation_record.location_id,
      true,
      invitation_record.weekly_capacity_minutes,
      invitation_record.color,
      invitation_record.invited_first_name,
      invitation_record.invited_last_name,
      invitation_record.email
    )
    on conflict (organization_id, profile_id) do update set
      role = excluded.role,
      location_id = coalesce(excluded.location_id, public.organization_members.location_id),
      active = true,
      weekly_capacity_minutes = excluded.weekly_capacity_minutes,
      color = excluded.color;
  end if;

  update public.profiles
  set
    first_name = coalesce(nullif(trim(invitation_record.invited_first_name), ''), first_name),
    last_name = coalesce(nullif(trim(invitation_record.invited_last_name), ''), last_name),
    current_organization_id = invitation_record.organization_id
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
