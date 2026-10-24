-- L'index unique des paiements d'entretien est partiel. PostgreSQL ne peut pas
-- l'utiliser avec ON CONFLICT sans répéter son prédicat. La période étant déjà
-- verrouillée, une mise à jour ou insertion explicite est sûre et idempotente.

create or replace function public.set_maintenance_billing_paid(
  target_period uuid,
  mark_paid boolean,
  payment_date timestamptz default now(),
  payment_method_name text default 'Virement'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  billing_record public.maintenance_billing_periods%rowtype;
  payment_id uuid;
begin
  select * into billing_record
  from public.maintenance_billing_periods
  where id = target_period
  for update;

  if not found then raise exception 'Échéance introuvable.'; end if;
  if not public.has_permission(billing_record.organization_id, 'business.manage') then
    raise exception 'Cette action est réservée aux administrateurs et associés.';
  end if;

  if mark_paid then
    select id into payment_id
    from public.payments
    where maintenance_billing_period_id = billing_record.id
    limit 1;

    if payment_id is null then
      insert into public.payments (
        organization_id, location_id, maintenance_contract_id, maintenance_billing_period_id,
        amount_cents, paid_at, method, created_by
      ) values (
        billing_record.organization_id, billing_record.location_id, billing_record.contract_id,
        billing_record.id, billing_record.amount_cents, payment_date, payment_method_name, auth.uid()
      )
      returning id into payment_id;
    else
      update public.payments
      set amount_cents = billing_record.amount_cents,
          paid_at = payment_date,
          method = payment_method_name,
          updated_at = now()
      where id = payment_id;
    end if;

    update public.maintenance_billing_periods
    set status = 'paid',
        paid_at = payment_date,
        payment_method = payment_method_name
    where id = billing_record.id;
  else
    delete from public.payments
    where maintenance_billing_period_id = billing_record.id;

    update public.maintenance_billing_periods
    set status = 'due',
        paid_at = null,
        payment_method = null
    where id = billing_record.id;

    payment_id := null;
  end if;

  return payment_id;
end;
$$;

revoke all on function public.set_maintenance_billing_paid(uuid, boolean, timestamptz, text) from public, anon;
grant execute on function public.set_maintenance_billing_paid(uuid, boolean, timestamptz, text) to authenticated;
