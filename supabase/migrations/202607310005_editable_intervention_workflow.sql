-- Édition complète d'une prestation : remplacement contrôlé de ses lignes et collaborateurs.

create policy intervention_items_org_delete on public.intervention_items
  for delete to authenticated
  using (public.is_org_member(organization_id));

create policy intervention_workers_org_delete on public.intervention_workers
  for delete to authenticated
  using (public.is_org_member(organization_id));

-- Les changements de prix, d'affectation et de durée restent traçables.
drop trigger if exists interventions_audit on public.interventions;
create trigger interventions_audit
  after insert or update or delete on public.interventions
  for each row execute function public.audit_sensitive_change();

drop trigger if exists intervention_items_audit on public.intervention_items;
create trigger intervention_items_audit
  after insert or update or delete on public.intervention_items
  for each row execute function public.audit_sensitive_change();

drop trigger if exists intervention_workers_audit on public.intervention_workers;
create trigger intervention_workers_audit
  after insert or update or delete on public.intervention_workers
  for each row execute function public.audit_sensitive_change();
