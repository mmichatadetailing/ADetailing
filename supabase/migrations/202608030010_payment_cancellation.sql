-- Un encaissement saisi par erreur doit pouvoir être annulé depuis la prestation.
-- Le trigger payments_refresh_invoice recalcule automatiquement le statut de la facture.
drop policy if exists payments_org_delete on public.payments;
create policy payments_org_delete
  on public.payments
  for delete
  to authenticated
  using (public.is_org_member(organization_id));
