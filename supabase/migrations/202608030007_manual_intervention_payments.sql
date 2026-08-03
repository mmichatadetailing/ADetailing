-- Un encaissement peut être rattaché soit à une facture, soit directement à
-- une prestation terminée. Les deux sources restent mutuellement exclusives.
alter table public.payments
  alter column invoice_id drop not null,
  add column if not exists intervention_id uuid references public.interventions(id) on delete cascade;

alter table public.payments
  add constraint payments_single_source_check
  check (num_nonnulls(invoice_id, intervention_id) = 1) not valid;

alter table public.payments validate constraint payments_single_source_check;

create index if not exists payments_intervention_idx
  on public.payments (organization_id, intervention_id, paid_at)
  where intervention_id is not null;
