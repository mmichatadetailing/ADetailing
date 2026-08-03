-- Fourchettes tarifaires indicatives par formule et format de véhicule.

alter table public.service_prices
  add column if not exists maximum_amount_cents bigint;

update public.service_prices
set maximum_amount_cents = amount_cents
where maximum_amount_cents is null;

alter table public.service_prices
  alter column maximum_amount_cents set not null,
  add constraint service_prices_range_check check (maximum_amount_cents >= amount_cents);
