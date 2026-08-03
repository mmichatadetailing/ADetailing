-- Une prestation peut être créée sans fiche véhicule détaillée.
-- La catégorie légère reste disponible pour la tarification et l'organisation.
alter table public.interventions
  alter column vehicle_id drop not null,
  add column if not exists vehicle_format text;
