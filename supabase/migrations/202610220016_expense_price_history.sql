-- Conserve les anciens tarifs des charges récurrentes. Une modification crée
-- une nouvelle version au lieu de réécrire les mois déjà écoulés.
alter table public.expenses
  add column if not exists ends_on date,
  add column if not exists series_id uuid,
  add column if not exists replaces_expense_id uuid references public.expenses(id);

update public.expenses
set series_id = id
where series_id is null;

alter table public.expenses
  alter column series_id set not null;

create index if not exists expenses_series_period_idx
  on public.expenses (organization_id, series_id, expense_date, ends_on);

create or replace function public.set_expense_series_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.series_id is null then
    new.series_id := new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_set_series_id on public.expenses;
create trigger expenses_set_series_id
  before insert on public.expenses
  for each row execute function public.set_expense_series_id();

create or replace function public.revise_recurring_expense(
  target_expense uuid,
  effective_on date,
  revision jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_expense public.expenses%rowtype;
  next_expense_id uuid;
  next_recurrence text;
  next_family text;
  next_amount bigint;
  next_vat_rate integer;
  next_amount_excluding_tax bigint;
  next_paid boolean;
begin
  select * into current_expense
  from public.expenses
  where id = target_expense
    and archived_at is null
  for update;

  if not found then
    raise exception 'Charge introuvable.';
  end if;
  if not public.has_permission(current_expense.organization_id, 'business.manage') then
    raise exception 'Cette action est réservée aux administrateurs et associés.';
  end if;
  if current_expense.recurrence = 'one_off' then
    raise exception 'Une dépense ponctuelle doit être modifiée directement.';
  end if;
  if current_expense.ends_on is not null then
    raise exception 'Cette ancienne version est verrouillée.';
  end if;
  if effective_on < current_expense.expense_date then
    raise exception 'La nouvelle date ne peut pas précéder la première échéance actuelle.';
  end if;

  next_recurrence := revision->>'recurrence';
  next_family := revision->>'family';
  next_amount := (revision->>'amountIncludingTax')::bigint;
  next_vat_rate := (revision->>'vatRateBasisPoints')::integer;
  next_paid := (revision->>'paid')::boolean;

  if next_recurrence not in ('monthly', 'annual', 'one_off') then
    raise exception 'Fréquence invalide.';
  end if;
  if next_family not in ('fixed', 'variable', 'investment', 'personal') then
    raise exception 'Famille invalide.';
  end if;
  if next_amount <= 0 or next_vat_rate < 0 or next_vat_rate > 10000 then
    raise exception 'Montant ou TVA invalide.';
  end if;

  next_amount_excluding_tax := round(next_amount::numeric / (1 + next_vat_rate::numeric / 10000));

  -- La date choisie est exacte : l’ancien tarif s’arrête la veille et le
  -- nouveau commence au jour sélectionné.
  update public.expenses
  set ends_on = effective_on - 1,
      updated_at = now()
  where id = current_expense.id;

  insert into public.expenses (
    organization_id, location_id, expense_date, ends_on, series_id, replaces_expense_id,
    family, category, supplier, description,
    amount_including_tax_cents, amount_excluding_tax_cents,
    vat_rate_basis_points, vat_amount_cents, vat_recoverable,
    recurrence, allocated_month, paid, paid_at, payment_method, created_by
  ) values (
    current_expense.organization_id,
    current_expense.location_id,
    effective_on,
    null,
    current_expense.series_id,
    current_expense.id,
    next_family,
    revision->>'category',
    nullif(revision->>'supplier', ''),
    revision->>'description',
    next_amount,
    next_amount_excluding_tax,
    next_vat_rate,
    next_amount - next_amount_excluding_tax,
    next_family <> 'personal',
    next_recurrence,
    date_trunc('month', effective_on)::date,
    next_paid,
    case when next_paid then effective_on::timestamp + interval '12 hours' else null end,
    case when next_paid then coalesce(current_expense.payment_method, 'Carte') else null end,
    auth.uid()
  ) returning id into next_expense_id;

  return next_expense_id;
end;
$$;

revoke all on function public.revise_recurring_expense(uuid, date, jsonb) from public, anon;
grant execute on function public.revise_recurring_expense(uuid, date, jsonb) to authenticated;

