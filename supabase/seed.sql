-- Données de référence anonymisées. Les utilisateurs Auth sont créés séparément.
insert into public.organizations (id, name, slug) values ('00000000-0000-4000-8000-000000000001', 'ADetailing', 'adetailing') on conflict do nothing;
insert into public.locations (id, organization_id, name, city, timezone) values ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001', 'ADetailing Orange', 'Orange', 'Europe/Paris') on conflict do nothing;
insert into public.vehicle_formats (organization_id, name, display_order) values
('00000000-0000-4000-8000-000000000001','Citadine',1),('00000000-0000-4000-8000-000000000001','Berline',2),('00000000-0000-4000-8000-000000000001','Break',3),('00000000-0000-4000-8000-000000000001','SUV',4),('00000000-0000-4000-8000-000000000001','Fourgon',5),('00000000-0000-4000-8000-000000000001','Autre',6)
on conflict do nothing;
insert into public.lead_sources (organization_id, name, display_order) values
('00000000-0000-4000-8000-000000000001','Site web',1),('00000000-0000-4000-8000-000000000001','Google',2),('00000000-0000-4000-8000-000000000001','Instagram',3),('00000000-0000-4000-8000-000000000001','TikTok',4),('00000000-0000-4000-8000-000000000001','Bouche-à-oreille',5),('00000000-0000-4000-8000-000000000001','Partenariat garage',6),('00000000-0000-4000-8000-000000000001','LinkedIn',7),('00000000-0000-4000-8000-000000000001','Prospection',8),('00000000-0000-4000-8000-000000000001','Autre',9)
on conflict do nothing;
insert into public.app_settings (organization_id, location_id, key, value, description) values
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','pilot_year','2026','Année de pilotage'),
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','initial_cash_cents','2786520','Trésorerie initiale'),
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','hourly_margin_target_cents','6000','Objectif de marge brute horaire'),
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','cash_safety_buffer_cents','300000','Marge de sécurité de trésorerie')
on conflict do nothing;

