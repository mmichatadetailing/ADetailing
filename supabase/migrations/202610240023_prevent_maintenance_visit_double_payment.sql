-- Une visite générée par un contrat porte une part de revenu analytique pour les
-- statistiques, mais ne constitue jamais une nouvelle somme à encaisser.

create or replace function public.prevent_maintenance_visit_direct_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.intervention_id is not null and exists (
    select 1
    from public.interventions
    where id = new.intervention_id
      and maintenance_contract_id is not null
  ) then
    raise exception 'Cette visite est incluse dans un contrat d’entretien. Enregistrez le paiement depuis le contrat.';
  end if;

  return new;
end;
$$;

drop trigger if exists payments_prevent_maintenance_visit_direct_payment on public.payments;
create trigger payments_prevent_maintenance_visit_direct_payment
  before insert or update of intervention_id on public.payments
  for each row execute function public.prevent_maintenance_visit_direct_payment();

revoke all on function public.prevent_maintenance_visit_direct_payment() from public, anon, authenticated;
