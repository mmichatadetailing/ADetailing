-- Identité préparée par le responsable lors de l'invitation.

alter table public.organization_invitations
  add column if not exists invited_first_name text not null default '',
  add column if not exists invited_last_name text not null default '';

alter table public.organization_invitations
  add constraint organization_invitations_first_name_length
    check (invited_first_name = '' or char_length(trim(invited_first_name)) between 2 and 80),
  add constraint organization_invitations_last_name_length
    check (invited_last_name = '' or char_length(trim(invited_last_name)) between 2 and 80);

-- La signature change pour exposer l'identité préremplie à l'inscription.
drop function if exists public.get_organization_invitation(text);

create function public.get_organization_invitation(invitation_token text)
returns table (
  organization_name text,
  invited_email text,
  invited_role public.member_role,
  invited_first_name text,
  invited_last_name text,
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
    i.invited_first_name,
    i.invited_last_name,
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

-- À l'acceptation, l'identité préparée devient l'identité initiale du profil.
-- Le membre peut ensuite la modifier lui-même grâce à la policy profiles_self_update.
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
