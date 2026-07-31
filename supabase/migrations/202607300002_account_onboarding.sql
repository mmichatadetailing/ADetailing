-- Comptes, profil utilisateur et création automatique d'un espace de travail.
alter table public.profiles add column if not exists email text;

create or replace function public.provision_user_workspace(
  target_user_id uuid,
  target_email text,
  user_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_organization_id uuid;
  new_organization_id uuid;
  new_location_id uuid;
  organization_name text;
  organization_slug text;
  first_name text;
  last_name text;
  city_name text;
begin
  if target_user_id is null then
    raise exception 'Utilisateur requis';
  end if;

  first_name := coalesce(nullif(trim(user_metadata ->> 'first_name'), ''), 'Utilisateur');
  last_name := coalesce(nullif(trim(user_metadata ->> 'last_name'), ''), '');
  organization_name := coalesce(nullif(trim(user_metadata ->> 'organization_name'), ''), 'Mon entreprise');
  city_name := coalesce(nullif(trim(user_metadata ->> 'city'), ''), 'À compléter');

  insert into public.profiles (id, first_name, last_name, email)
  values (target_user_id, first_name, last_name, lower(target_email))
  on conflict (id) do update set
    email = coalesce(excluded.email, public.profiles.email),
    first_name = case when public.profiles.first_name = '' then excluded.first_name else public.profiles.first_name end,
    last_name = case when public.profiles.last_name = '' then excluded.last_name else public.profiles.last_name end;

  select organization_id into existing_organization_id
  from public.organization_members
  where profile_id = target_user_id and active
  order by created_at
  limit 1;

  if existing_organization_id is not null then
    return existing_organization_id;
  end if;

  organization_slug := trim(both '-' from regexp_replace(lower(unaccent(organization_name)), '[^a-z0-9]+', '-', 'g'));
  if organization_slug = '' then organization_slug := 'entreprise'; end if;
  organization_slug := organization_slug || '-' || left(replace(target_user_id::text, '-', ''), 8);

  insert into public.organizations (name, slug)
  values (organization_name, organization_slug)
  returning id into new_organization_id;

  insert into public.locations (organization_id, name, city)
  values (new_organization_id, organization_name, city_name)
  returning id into new_location_id;

  insert into public.organization_members (
    organization_id, profile_id, role, location_id, weekly_capacity_minutes, color
  ) values (
    new_organization_id, target_user_id, 'admin', new_location_id, 2100, '#f9734f'
  );

  insert into public.vehicle_formats (organization_id, name, display_order) values
    (new_organization_id, 'Citadine', 1),
    (new_organization_id, 'Berline', 2),
    (new_organization_id, 'Break', 3),
    (new_organization_id, 'SUV', 4),
    (new_organization_id, 'Fourgon', 5),
    (new_organization_id, 'Autre', 6);

  insert into public.lead_sources (organization_id, name, display_order) values
    (new_organization_id, 'Site web', 1),
    (new_organization_id, 'Google', 2),
    (new_organization_id, 'Instagram', 3),
    (new_organization_id, 'TikTok', 4),
    (new_organization_id, 'Bouche-à-oreille', 5),
    (new_organization_id, 'Partenariat garage', 6),
    (new_organization_id, 'LinkedIn', 7),
    (new_organization_id, 'Prospection', 8),
    (new_organization_id, 'Autre', 9);

  insert into public.app_settings (organization_id, location_id, key, value, description) values
    (new_organization_id, new_location_id, 'pilot_year', to_jsonb(extract(year from current_date)::integer), 'Année de pilotage'),
    (new_organization_id, new_location_id, 'initial_cash_cents', '0'::jsonb, 'Trésorerie initiale'),
    (new_organization_id, new_location_id, 'hourly_margin_target_cents', '6000'::jsonb, 'Objectif de marge brute horaire'),
    (new_organization_id, new_location_id, 'cash_safety_buffer_cents', '300000'::jsonb, 'Marge de sécurité de trésorerie'),
    (new_organization_id, new_location_id, 'standard_vat_basis_points', '2000'::jsonb, 'Taux de TVA standard');

  insert into public.conversations (organization_id, kind, title, created_by)
  values (new_organization_id, 'general', 'Général', target_user_id);

  return new_organization_id;
end;
$$;

revoke all on function public.provision_user_workspace(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.ensure_user_workspace() returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_record auth.users%rowtype;
begin
  select * into current_user_record from auth.users where id = auth.uid();
  if current_user_record.id is null then
    raise exception 'Utilisateur non authentifié';
  end if;
  return public.provision_user_workspace(
    current_user_record.id,
    current_user_record.email,
    coalesce(current_user_record.raw_user_meta_data, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.ensure_user_workspace() from public;
grant execute on function public.ensure_user_workspace() to authenticated;

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.provision_user_workspace(
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

-- Les écritures administratives ne doivent pas hériter de la politique générique « membre ».
drop policy if exists organization_members_org_insert on public.organization_members;
drop policy if exists organization_members_org_update on public.organization_members;
create policy organization_members_manager_insert on public.organization_members
  for insert to authenticated
  with check (public.has_permission(organization_id, 'team.manage'));
create policy organization_members_manager_update on public.organization_members
  for update to authenticated
  using (public.has_permission(organization_id, 'team.manage'))
  with check (public.has_permission(organization_id, 'team.manage'));

drop policy if exists role_permissions_org_insert on public.role_permissions;
drop policy if exists role_permissions_org_update on public.role_permissions;
create policy role_permissions_manager_insert on public.role_permissions
  for insert to authenticated
  with check (public.has_permission(organization_id, 'permissions.manage'));
create policy role_permissions_manager_update on public.role_permissions
  for update to authenticated
  using (public.has_permission(organization_id, 'permissions.manage'))
  with check (public.has_permission(organization_id, 'permissions.manage'));

drop policy if exists app_settings_org_insert on public.app_settings;
drop policy if exists app_settings_org_update on public.app_settings;
create policy app_settings_manager_insert on public.app_settings
  for insert to authenticated
  with check (public.has_permission(organization_id, 'settings.manage'));
create policy app_settings_manager_update on public.app_settings
  for update to authenticated
  using (public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'settings.manage'));

create policy organizations_admin_update on public.organizations
  for update to authenticated
  using (public.has_permission(id, 'organization.update'))
  with check (public.has_permission(id, 'organization.update'));
