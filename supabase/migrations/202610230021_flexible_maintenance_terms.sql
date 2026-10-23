-- La durée d'un forfait prépayé pilote directement le nombre de visites :
-- un mois payé correspond à une prestation mensuelle générée.

alter table public.maintenance_contracts
  drop constraint if exists maintenance_contracts_term_check;

alter table public.maintenance_contracts
  add constraint maintenance_contracts_term_check
    check (
      (billing_frequency = 'prepaid' and term_months between 1 and 36)
      or (billing_frequency <> 'prepaid' and term_months is null)
    ) not valid;

alter table public.maintenance_contracts
  validate constraint maintenance_contracts_term_check;

create or replace function public.renew_maintenance_contract(target_contract uuid)
returns table (new_ends_on date, generated_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  contract_record public.maintenance_contracts%rowtype;
begin
  select * into contract_record
  from public.maintenance_contracts
  where id = target_contract and archived_at is null
  for update;

  if not found then raise exception 'Contrat d’entretien introuvable.'; end if;
  if not public.has_permission(contract_record.organization_id, 'business.manage') then
    raise exception 'Cette action est réservée aux administrateurs et associés.';
  end if;
  if contract_record.billing_frequency <> 'prepaid'
    or contract_record.term_months is null
    or contract_record.term_months not between 1 and 36
    or contract_record.ends_on is null then
    raise exception 'Seuls les forfaits prépayés d’une durée comprise entre 1 et 36 mois peuvent être renouvelés.';
  end if;

  new_ends_on := (contract_record.ends_on + make_interval(months => contract_record.term_months))::date;
  update public.maintenance_contracts
  set ends_on = new_ends_on, status = 'active'
  where id = contract_record.id;

  generated_count := public.generate_maintenance_schedule(contract_record.id, new_ends_on);
  return next;
end;
$$;

revoke all on function public.renew_maintenance_contract(uuid) from public, anon;
grant execute on function public.renew_maintenance_contract(uuid) to authenticated;
