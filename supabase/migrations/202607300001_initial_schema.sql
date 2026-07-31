-- ADetailing Pilotage — schéma initial multi-organisation
create extension if not exists pgcrypto;
create extension if not exists unaccent;

create type public.member_role as enum ('admin', 'partner', 'employee');
create type public.lead_stage as enum ('received', 'qualify', 'quote_to_prepare', 'quote_sent', 'follow_up', 'won', 'lost');
create type public.quote_status as enum ('imported', 'to_review', 'sent', 'accepted', 'refused', 'expired', 'cancelled');
create type public.invoice_status as enum ('imported', 'to_review', 'issued', 'cancelled', 'credit_note');
create type public.payment_status as enum ('unpaid', 'partial', 'paid', 'overdue');
create type public.intervention_status as enum ('to_schedule', 'scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled');
create type public.service_kind as enum ('formula', 'option', 'subscription', 'pack');

create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table public.locations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  name text not null, city text not null, address text, postal_code text, timezone text not null default 'Europe/Paris', active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, name)
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, first_name text not null default '', last_name text not null default '',
  phone text, avatar_path text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.organization_members (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade, role public.member_role not null,
  location_id uuid references public.locations(id), active boolean not null default true, weekly_capacity_minutes integer not null default 2100 check (weekly_capacity_minutes >= 0),
  color text not null default '#f97316', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, profile_id)
);
create table public.role_permissions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  role public.member_role not null, permission text not null, allowed boolean not null default true, unique (organization_id, role, permission)
);

create table public.lead_sources (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), name text not null,
  display_order integer not null default 0, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, name)
);
create table public.clients (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id),
  kind text not null check (kind in ('individual','business')), company text, first_name text not null default '', last_name text not null default '',
  email text, phone text, normalized_phone text, address text, postal_code text, city text, siret text, vat_number text,
  lead_source_id uuid references public.lead_sources(id), owner_id uuid references public.profiles(id), notes text, next_action text,
  legacy_id text, legacy_row integer, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create index clients_org_search_idx on public.clients (organization_id, lower(last_name), lower(company));
create index clients_phone_idx on public.clients (organization_id, normalized_phone) where normalized_phone is not null;
create table public.vehicle_formats (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), name text not null, display_order integer not null default 0,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, name)
);
create table public.vehicles (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id),
  client_id uuid not null references public.clients(id), format_id uuid references public.vehicle_formats(id), make text not null, model text not null,
  registration text, year integer check (year between 1900 and 2200), color text, mileage integer check (mileage >= 0), initial_condition text, notes text,
  legacy_id text, legacy_row integer, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create index vehicles_registration_idx on public.vehicles (organization_id, upper(registration));
create table public.leads (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id),
  client_id uuid references public.clients(id), prospect_name text not null, company text, phone text, email text, vehicle_label text, service_label text,
  estimated_amount_cents bigint not null default 0 check (estimated_amount_cents >= 0), source_id uuid references public.lead_sources(id), stage public.lead_stage not null default 'received',
  owner_id uuid references public.profiles(id), requested_at timestamptz not null default now(), next_action text, next_action_at timestamptz,
  decided_at timestamptz, lost_reason text, notes text, legacy_id text, legacy_row integer, import_fingerprint text,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create index leads_org_stage_idx on public.leads (organization_id, stage, next_action_at);
create unique index leads_import_fingerprint_idx on public.leads (organization_id, import_fingerprint) where import_fingerprint is not null;
create table public.lead_activities (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null, description text, occurred_at timestamptz not null default now(), created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.service_categories (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), name text not null, display_order integer not null default 0,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz, unique (organization_id, name)
);
create table public.service_checklist_templates (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), name text not null, description text,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table public.service_checklist_template_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), template_id uuid not null references public.service_checklist_templates(id),
  label text not null, required boolean not null default true, display_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.services (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), kind public.service_kind not null,
  category_id uuid references public.service_categories(id), name text not null, client_description text, internal_description text,
  target_duration_minutes integer not null default 0 check (target_duration_minutes >= 0), target_product_cost_cents bigint not null default 0 check (target_product_cost_cents >= 0),
  target_travel_cost_cents bigint not null default 0 check (target_travel_cost_cents >= 0), target_hourly_margin_cents bigint not null default 0 check (target_hourly_margin_cents >= 0),
  vat_rate_basis_points integer not null default 2000 check (vat_rate_basis_points between 0 and 10000), checklist_template_id uuid references public.service_checklist_templates(id),
  recommended_workers integer not null default 1 check (recommended_workers > 0), photos_required boolean not null default false,
  active boolean not null default true, display_order integer not null default 0, legacy_id text, legacy_row integer,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, name)
);
create table public.service_prices (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), service_id uuid not null references public.services(id),
  vehicle_format_id uuid references public.vehicle_formats(id), amount_cents bigint not null check (amount_cents >= 0), valid_from date not null default current_date, valid_until date,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique nulls not distinct (service_id, vehicle_format_id, valid_from)
);
create table public.service_aliases (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), service_id uuid not null references public.services(id),
  vehicle_format_id uuid references public.vehicle_formats(id), alias text not null, normalized_alias text not null,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, normalized_alias)
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id),
  client_id uuid not null references public.clients(id), number text not null, status public.quote_status not null default 'imported', issued_at date,
  valid_until date, accepted_at timestamptz, total_excluding_tax_cents bigint not null default 0 check (total_excluding_tax_cents >= 0), total_tax_cents bigint not null default 0 check (total_tax_cents >= 0),
  total_including_tax_cents bigint not null default 0 check (total_including_tax_cents >= 0), payment_terms text, next_follow_up_at timestamptz,
  source_file_path text, source_text text, legacy_id text, legacy_row integer, import_fingerprint text,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, number)
);
create table public.quote_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), quote_id uuid not null references public.quotes(id) on delete cascade,
  service_id uuid references public.services(id), vehicle_id uuid references public.vehicles(id), designation text not null, description text, quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0), discount_cents bigint not null default 0 check (discount_cents >= 0), net_amount_cents bigint not null default 0 check (net_amount_cents >= 0),
  vat_rate_basis_points integer not null default 0 check (vat_rate_basis_points between 0 and 10000), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id),
  client_id uuid not null references public.clients(id), quote_id uuid references public.quotes(id), number text not null, status public.invoice_status not null default 'imported',
  payment_status public.payment_status not null default 'unpaid', issued_at date, due_at date,
  total_excluding_tax_cents bigint not null default 0 check (total_excluding_tax_cents >= 0), total_tax_cents bigint not null default 0 check (total_tax_cents >= 0),
  total_including_tax_cents bigint not null default 0 check (total_including_tax_cents >= 0), expected_payment_method text, source_file_path text, source_text text,
  legacy_id text, legacy_row integer, import_fingerprint text, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, number)
);
create index invoices_org_due_idx on public.invoices (organization_id, payment_status, due_at);
create table public.invoice_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), invoice_id uuid not null references public.invoices(id) on delete cascade,
  service_id uuid references public.services(id), vehicle_id uuid references public.vehicles(id), designation text not null, description text, quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0), discount_cents bigint not null default 0 check (discount_cents >= 0), net_amount_cents bigint not null default 0 check (net_amount_cents >= 0),
  vat_rate_basis_points integer not null default 0 check (vat_rate_basis_points between 0 and 10000), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.payments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id),
  invoice_id uuid not null references public.invoices(id), amount_cents bigint not null check (amount_cents > 0), paid_at timestamptz not null,
  method text not null, reference text, notes text, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index payments_org_date_idx on public.payments (organization_id, paid_at);

create table public.interventions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id),
  client_id uuid not null references public.clients(id), vehicle_id uuid not null references public.vehicles(id), quote_id uuid references public.quotes(id), invoice_id uuid references public.invoices(id),
  status public.intervention_status not null default 'to_schedule', title text not null, start_at timestamptz, end_at timestamptz,
  planned_duration_minutes integer not null default 0 check (planned_duration_minutes >= 0), actual_duration_minutes integer check (actual_duration_minutes >= 0),
  preparation_minutes integer not null default 0 check (preparation_minutes >= 0), cleanup_minutes integer not null default 0 check (cleanup_minutes >= 0),
  product_cost_cents bigint not null default 0 check (product_cost_cents >= 0), travel_cost_cents bigint not null default 0 check (travel_cost_cents >= 0), other_direct_costs_cents bigint not null default 0 check (other_direct_costs_cents >= 0),
  address text, latitude numeric(10,7), longitude numeric(10,7), deposit_amount_cents bigint not null default 0 check (deposit_amount_cents >= 0), notes text,
  legacy_id text, legacy_row integer, import_fingerprint text, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  check (end_at is null or start_at is null or end_at > start_at)
);
create index interventions_org_start_idx on public.interventions (organization_id, start_at, status);
create table public.intervention_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), intervention_id uuid not null references public.interventions(id) on delete cascade,
  service_id uuid references public.services(id), label text not null, quantity numeric(12,3) not null default 1 check (quantity > 0), revenue_allocated_cents bigint not null default 0 check (revenue_allocated_cents >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.intervention_workers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), intervention_id uuid not null references public.interventions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id), planned_minutes integer not null default 0 check (planned_minutes >= 0), actual_minutes integer check (actual_minutes >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (intervention_id, profile_id)
);
create table public.intervention_checklist_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), intervention_id uuid not null references public.interventions(id) on delete cascade,
  label text not null, required boolean not null default true, completed boolean not null default false, completed_at timestamptz, completed_by uuid references public.profiles(id), display_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id),
  expense_date date not null, family text not null check (family in ('fixed','variable','investment','personal')), category text not null, supplier text, description text not null,
  amount_including_tax_cents bigint not null check (amount_including_tax_cents >= 0), amount_excluding_tax_cents bigint not null check (amount_excluding_tax_cents >= 0),
  vat_rate_basis_points integer not null default 0 check (vat_rate_basis_points between 0 and 10000), vat_amount_cents bigint not null default 0 check (vat_amount_cents >= 0), vat_recoverable boolean not null default false,
  recurrence text not null default 'one_off' check (recurrence in ('monthly','annual','one_off')), allocated_month date not null, paid boolean not null default false, paid_at timestamptz, payment_method text,
  receipt_path text, comment text, legacy_id text, legacy_row integer, import_fingerprint text, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create unique index expenses_import_fingerprint_idx on public.expenses (organization_id, import_fingerprint) where import_fingerprint is not null;
create table public.recurring_expense_rules (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id),
  family text not null, category text not null, supplier text, description text not null, amount_including_tax_cents bigint not null check (amount_including_tax_cents >= 0),
  vat_rate_basis_points integer not null default 0, frequency text not null check (frequency in ('monthly','annual')), starts_on date not null, ends_on date, next_occurrence_on date not null, active boolean not null default true,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table public.assets (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id), expense_id uuid references public.expenses(id),
  acquired_on date, name text not null, category text, price_including_tax_cents bigint not null default 0 check (price_including_tax_cents >= 0), price_excluding_tax_cents bigint not null default 0 check (price_excluding_tax_cents >= 0),
  useful_life_months integer check (useful_life_months > 0), status text not null check (status in ('to_buy','ordered','in_service','to_replace','sold')), priority text not null default 'medium' check (priority in ('low','medium','high')),
  monthly_revenue_required_cents bigint not null default 0, expected_time_gain_minutes integer not null default 0, expected_roi_months numeric(10,2), roi_assumptions jsonb not null default '{}'::jsonb,
  supplier text, invoice_id uuid references public.invoices(id), commissioned_on date, planned_replacement_on date, comment text,
  legacy_id text, legacy_row integer, import_fingerprint text, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table public.monthly_objectives (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id), month date not null,
  revenue_target_cents bigint not null default 0, intervention_target integer not null default 0, average_basket_target_cents bigint not null default 0,
  gross_margin_target_cents bigint not null default 0, hourly_margin_target_cents bigint not null default 0, review_target integer not null default 0, note text,
  legacy_id text, legacy_row integer, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, location_id, month)
);
create table public.work_schedules (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), profile_id uuid not null references public.profiles(id), location_id uuid references public.locations(id),
  weekday smallint not null check (weekday between 0 and 6), starts_at time not null, ends_at time not null, valid_from date not null, valid_until date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (ends_at > starts_at)
);
create table public.absences (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), profile_id uuid not null references public.profiles(id),
  kind text not null, starts_at timestamptz not null, ends_at timestamptz not null, private boolean not null default true, note text,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (ends_at > starts_at)
);
create table public.capacity_snapshots (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id), month date not null,
  available_minutes integer not null default 0, planned_minutes integer not null default 0, actual_minutes integer not null default 0, person_minutes integer not null default 0,
  planned_revenue_cents bigint not null default 0, realized_revenue_cents bigint not null default 0, legacy_row integer, imported_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, location_id, month)
);

create table public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), profile_id uuid not null references public.profiles(id),
  google_account_email text not null, encrypted_refresh_token text not null, token_key_version integer not null default 1, selected_calendar_ids jsonb not null default '[]'::jsonb,
  sync_enabled boolean not null default true, last_synced_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, profile_id, google_account_email)
);
create table public.calendar_event_mappings (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), connection_id uuid not null references public.google_calendar_connections(id) on delete cascade,
  intervention_id uuid references public.interventions(id), internal_event_id uuid, google_calendar_id text not null, google_event_id text not null, google_etag text,
  last_internal_version timestamptz, last_google_version timestamptz, sync_status text not null default 'synced', last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (connection_id, google_calendar_id, google_event_id)
);
create table public.reviews (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), client_id uuid not null references public.clients(id), intervention_id uuid references public.interventions(id),
  requested_at timestamptz, received_at timestamptz, rating numeric(2,1) check (rating between 0 and 5), comment text, url text, content_authorized boolean not null default false,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.attachments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id),
  entity_type text not null, entity_id uuid not null, kind text not null, storage_bucket text not null, storage_path text not null, file_name text not null, mime_type text, size_bytes bigint check (size_bytes >= 0),
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table public.conversations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), kind text not null check (kind in ('general','entity')), entity_type text, entity_id uuid, title text,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);
create table public.conversation_members (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id), last_read_at timestamptz, muted boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (conversation_id, profile_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_id uuid not null references public.profiles(id), body text not null, edited_at timestamptz, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), profile_id uuid not null references public.profiles(id),
  kind text not null, title text not null, body text, entity_type text, entity_id uuid, read_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.document_imports (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id),
  kind text not null check (kind in ('pdf','xlsx','email','form')), file_name text not null, storage_path text, file_hash text not null, status text not null,
  source_text text, parsed_payload jsonb not null default '{}'::jsonb, report jsonb not null default '{}'::jsonb, imported_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, file_hash)
);
create table public.document_import_fields (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), document_import_id uuid not null references public.document_imports(id) on delete cascade,
  field_name text not null, raw_value text, parsed_value jsonb, confidence numeric(4,3) check (confidence between 0 and 1), status text not null default 'detected', corrected_value jsonb,
  corrected_by uuid references public.profiles(id), corrected_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), actor_id uuid references public.profiles(id),
  kind text not null, title text not null, description text, entity_type text, entity_id uuid, occurred_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), actor_id uuid references public.profiles(id),
  action text not null, table_name text not null, record_id uuid, before_data jsonb, after_data jsonb, request_id text, ip_hash text,
  created_at timestamptz not null default now()
);
create table public.app_settings (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), location_id uuid references public.locations(id),
  key text not null, value jsonb not null, description text, sensitive boolean not null default false, updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique nulls not distinct (organization_id, location_id, key)
);

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.organization_members m where m.organization_id = target_org and m.profile_id = auth.uid() and m.active); $$;
create or replace function public.has_permission(target_org uuid, permission_name text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org and m.profile_id = auth.uid() and m.active
      and (m.role in ('admin','partner') or exists (
        select 1 from public.role_permissions p where p.organization_id = target_org and p.role = m.role and p.permission = permission_name and p.allowed
      ))
  );
$$;
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_permission(uuid, text) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;

-- RLS de base : isolation stricte par organisation.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'locations','organization_members','role_permissions','lead_sources','clients','vehicle_formats','vehicles','leads','lead_activities',
    'service_categories','service_checklist_templates','service_checklist_template_items','services','service_prices','service_aliases',
    'quotes','quote_items','invoices','invoice_items','payments','interventions','intervention_items','intervention_workers','intervention_checklist_items',
    'expenses','recurring_expense_rules','assets','monthly_objectives','work_schedules','absences','capacity_snapshots','google_calendar_connections','calendar_event_mappings',
    'reviews','attachments','conversations','conversation_members','messages','notifications','document_imports','document_import_fields','activity_logs','audit_logs','app_settings'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))', table_name || '_org_select', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_org_member(organization_id))', table_name || '_org_insert', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id))', table_name || '_org_update', table_name);
  end loop;
end $$;
alter table public.organizations enable row level security;
create policy organizations_member_select on public.organizations for select to authenticated using (public.is_org_member(id));
alter table public.profiles enable row level security;
create policy profiles_self_select on public.profiles for select to authenticated using (id = auth.uid() or exists(select 1 from public.organization_members me join public.organization_members them on them.organization_id = me.organization_id where me.profile_id = auth.uid() and them.profile_id = profiles.id));
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Les tables financières demandent une permission explicite pour les employés.
drop policy expenses_org_select on public.expenses;
drop policy payments_org_select on public.payments;
drop policy assets_org_select on public.assets;
drop policy monthly_objectives_org_select on public.monthly_objectives;
create policy expenses_finance_select on public.expenses for select to authenticated using (public.has_permission(organization_id, 'finance.read'));
create policy payments_finance_select on public.payments for select to authenticated using (public.has_permission(organization_id, 'finance.read'));
create policy assets_finance_select on public.assets for select to authenticated using (public.has_permission(organization_id, 'finance.read'));
create policy objectives_finance_select on public.monthly_objectives for select to authenticated using (public.has_permission(organization_id, 'finance.read'));

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
do $$ declare table_name text; begin
  foreach table_name in array array['organizations','locations','profiles','organization_members','clients','vehicles','leads','services','service_prices','quotes','invoices','payments','interventions','expenses','assets','monthly_objectives','messages','app_settings'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', table_name || '_touch_updated_at', table_name);
  end loop;
end $$;

create or replace function public.audit_sensitive_change() returns trigger language plpgsql security definer set search_path = public as $$
declare org uuid; rid uuid; begin
  org := coalesce(new.organization_id, old.organization_id); rid := coalesce(new.id, old.id);
  insert into public.audit_logs (organization_id, actor_id, action, table_name, record_id, before_data, after_data)
  values (org, auth.uid(), tg_op, tg_table_name, rid, case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
do $$ declare table_name text; begin
  foreach table_name in array array['quotes','invoices','payments','expenses','assets','monthly_objectives','organization_members','document_imports'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_sensitive_change()', table_name || '_audit', table_name);
  end loop;
end $$;

-- Recalcule le statut de paiement sans jamais déduire qu’une facture émise est payée.
create or replace function public.refresh_invoice_payment_status(target_invoice uuid) returns void language plpgsql security definer set search_path = public as $$
declare total bigint; paid bigint; due date; next_status public.payment_status; begin
  select total_including_tax_cents, due_at into total, due from public.invoices where id = target_invoice;
  select coalesce(sum(amount_cents), 0) into paid from public.payments where invoice_id = target_invoice;
  next_status := case when paid >= total and total > 0 then 'paid' when paid > 0 then 'partial' when due < current_date then 'overdue' else 'unpaid' end;
  update public.invoices set payment_status = next_status where id = target_invoice;
end $$;
create or replace function public.after_payment_change() returns trigger language plpgsql security definer set search_path = public as $$ begin perform public.refresh_invoice_payment_status(coalesce(new.invoice_id, old.invoice_id)); return coalesce(new, old); end $$;
create trigger payments_refresh_invoice after insert or update or delete on public.payments for each row execute function public.after_payment_change();

-- Storage : buckets privés ; les chemins commencent par organization_id.
insert into storage.buckets (id, name, public) values ('documents', 'documents', false), ('intervention-photos', 'intervention-photos', false)
on conflict (id) do update set public = false;
create policy storage_org_read on storage.objects for select to authenticated using ((bucket_id in ('documents','intervention-photos')) and public.is_org_member((storage.foldername(name))[1]::uuid));
create policy storage_org_insert on storage.objects for insert to authenticated with check ((bucket_id in ('documents','intervention-photos')) and public.is_org_member((storage.foldername(name))[1]::uuid));

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

