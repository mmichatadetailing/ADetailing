-- Modes de tarification configurables et paliers d'abonnement par nombre de véhicules.

alter table public.services
  add column if not exists pricing_mode text not null default 'vehicle_format';

alter table public.services
  drop constraint if exists services_pricing_mode_check,
  add constraint services_pricing_mode_check
    check (pricing_mode in ('vehicle_format', 'vehicle_count', 'custom'));

alter table public.service_prices
  add column if not exists pricing_label text,
  add column if not exists minimum_vehicle_count integer,
  add column if not exists maximum_vehicle_count integer;

update public.service_prices as price
set pricing_label = coalesce(format.name, 'Tous formats')
from public.vehicle_formats as format
where price.vehicle_format_id = format.id
  and price.pricing_label is null;

update public.service_prices
set pricing_label = 'Tous formats'
where pricing_label is null;

alter table public.service_prices
  alter column pricing_label set not null,
  drop constraint if exists service_prices_vehicle_count_check,
  add constraint service_prices_vehicle_count_check check (
    (minimum_vehicle_count is null and maximum_vehicle_count is null)
    or (
      minimum_vehicle_count >= 1
      and (maximum_vehicle_count is null or maximum_vehicle_count >= minimum_vehicle_count)
    )
  );

alter table public.service_prices
  drop constraint if exists service_prices_service_id_vehicle_format_id_valid_from_key;

create unique index if not exists service_prices_service_label_valid_from_key
  on public.service_prices (service_id, pricing_label, valid_from);

comment on column public.services.pricing_mode is
  'vehicle_format: tarif par catégorie, vehicle_count: paliers par quantité, custom: règles libres';
comment on column public.service_prices.amount_cents is
  'Pour vehicle_count, prix unitaire par véhicule et par période d’abonnement.';
