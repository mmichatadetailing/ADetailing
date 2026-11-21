-- Keep explicit cash payments in the internal register. Do not recategorize
-- historical rows: absence of a bank link is not proof of a cash payment.
create function public.is_recorded_cash_charge(e public.expenses) returns boolean
language sql immutable set search_path=public as $$
  select coalesce(e.paid and e.recurrence='one_off' and
    public.qonto_identity(e.payment_method) ~ '^(en )?(especes?|liquides?|cash)$', false)
$$;
revoke all on function public.is_recorded_cash_charge(public.expenses) from public,anon,authenticated;

-- Also enforce the distinction if the supplier/amount coincide or the method
-- changes while a sync is in progress. Lock the same expense in both paths.
create function public.guard_cash_charge_link() returns trigger
language plpgsql security definer set search_path=public as $$
declare e public.expenses%rowtype;
begin
  if tg_table_name='expense_settlements' then
    select * into strict e from public.expenses where id=new.expense_id for update;
    if public.is_recorded_cash_charge(e) then
      raise exception 'Une charge réglée en espèces ne peut pas être rapprochée d’un débit bancaire.';
    end if;
  elsif public.is_recorded_cash_charge(new) and exists(select 1 from public.expense_settlements where expense_id=new.id) then
    raise exception 'Un règlement bancaire est déjà rattaché à cette charge.';
  end if;
  return new;
end $$;
revoke all on function public.guard_cash_charge_link() from public,anon,authenticated;
create trigger cash_charge_before_bank_link before insert or update of expense_id,bank_transaction_id
  on public.expense_settlements for each row execute function public.guard_cash_charge_link();
create trigger cash_charge_before_method_change before update of payment_method,recurrence,paid
  on public.expenses for each row execute function public.guard_cash_charge_link();

-- The existing authorized revision remains atomic, including when converting
-- a recurring budget to a paid one-off. Do not invent a default card payment.
alter function public.revise_recurring_expense(uuid,date,jsonb) rename to revise_recurring_expense_version;
revoke all on function public.revise_recurring_expense_version(uuid,date,jsonb) from public,anon,authenticated,service_role;
create function public.revise_recurring_expense(target_expense uuid,effective_on date,revision jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare revised uuid;
begin
  revised := public.revise_recurring_expense_version(target_expense,effective_on,revision);
  update public.expenses set payment_method=case when paid and recurrence='one_off' then nullif(trim(revision->>'paymentMethod'),'') end,
    paid_at=case when paid and recurrence='one_off' then
      (coalesce((revision->>'paidOn')::date,effective_on)+time '12:00') at time zone 'Europe/Paris' else paid_at end
    where id=revised;
  return revised;
end $$;
revoke all on function public.revise_recurring_expense(uuid,date,jsonb) from public,anon;
grant execute on function public.revise_recurring_expense(uuid,date,jsonb) to authenticated;
