import type { Client, Intervention, MaintenanceBillingPeriod, MaintenanceContract, Money } from "./types";

export interface MaintenanceScheduleEntry {
  month: string;
  visitOn: string;
  billingDue: boolean;
  billingAmount: Money;
  recognizedRevenue: Money;
}

export interface MaintenanceRouteGroup {
  key: string;
  date: string;
  city: string;
  interventions: Intervention[];
  totalMinutes: number;
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function monthOffset(month: string, offset: number) {
  const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + offset, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function maintenanceTermEndDate(firstVisitOn: string, termMonths: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstVisitOn) || !Number.isInteger(termMonths) || termMonths < 1) return "";
  const source = new Date(`${firstVisitOn}T12:00:00`);
  if (Number.isNaN(source.getTime())) return "";
  const target = new Date(source.getFullYear(), source.getMonth() + termMonths - 1, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(source.getDate(), lastDay));
  return dateKey(target);
}

export function maintenanceWeekdayDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  if (date.getDay() === 6) date.setDate(date.getDate() + 2);
  else if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return dateKey(date);
}

function recognitionMonths(contract: Pick<MaintenanceContract, "billingFrequency" | "termMonths">) {
  return contract.billingFrequency === "monthly" ? 1 : contract.billingFrequency === "prepaid" ? contract.termMonths ?? 12 : 12;
}

export function maintenanceMonthlyRevenue(contract: Pick<MaintenanceContract, "billingFrequency" | "billingAmount" | "termMonths">) {
  return Math.round(contract.billingAmount / recognitionMonths(contract));
}

export function maintenanceAnnualValue(contract: Pick<MaintenanceContract, "billingFrequency" | "billingAmount" | "termMonths">) {
  return maintenanceMonthlyRevenue(contract) * 12;
}

export function maintenanceSchedule(
  contract: Pick<MaintenanceContract, "firstVisitOn" | "visitDay" | "endsOn" | "billingFrequency" | "billingAmount" | "termMonths">,
  through: string,
): MaintenanceScheduleEntry[] {
  const firstMonth = contract.firstVisitOn.slice(0, 7);
  const lastMonth = through.slice(0, 7);
  const result: MaintenanceScheduleEntry[] = [];

  for (let month = firstMonth, index = 0; month <= lastMonth; month = monthOffset(firstMonth, ++index)) {
    const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
    const nominalVisitOn = `${month}-${String(Math.min(contract.visitDay, lastDay)).padStart(2, "0")}`;
    if (nominalVisitOn < contract.firstVisitOn || (contract.endsOn && nominalVisitOn > contract.endsOn)) continue;
    const visitOn = maintenanceWeekdayDate(nominalVisitOn);
    const monthsCovered = recognitionMonths(contract);
    const billingDue = contract.billingFrequency === "monthly" || index % monthsCovered === 0;
    const recognizedRevenue = monthsCovered === 1
      ? contract.billingAmount
      : Math.floor(contract.billingAmount / monthsCovered) + (index % monthsCovered < contract.billingAmount % monthsCovered ? 1 : 0);
    result.push({ month, visitOn, billingDue, billingAmount: billingDue ? contract.billingAmount : 0, recognizedRevenue });
  }
  return result;
}

export function maintenanceRenewalStatus(
  contract: Pick<MaintenanceContract, "billingFrequency" | "endsOn" | "renewalReminderDays" | "status">,
  reference = new Date(),
) {
  if (contract.status !== "active" || contract.billingFrequency !== "prepaid" || !contract.endsOn) {
    return { state: "not_applicable" as const, daysRemaining: null, reminderOn: undefined };
  }
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 12);
  const end = new Date(`${contract.endsOn}T12:00:00`);
  const reminder = new Date(end);
  reminder.setDate(reminder.getDate() - contract.renewalReminderDays);
  const daysRemaining = Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
  return {
    state: end < today ? "expired" as const : reminder <= today ? "due" as const : "later" as const,
    daysRemaining,
    reminderOn: dateKey(reminder),
  };
}

export function nextMaintenanceVisit(
  contractId: string,
  interventions: Array<Pick<Intervention, "maintenanceContractId" | "startAt" | "status">>,
  reference = new Date(),
) {
  const referenceKey = dateKey(reference);
  return interventions
    .filter((intervention) => intervention.maintenanceContractId === contractId && intervention.startAt && intervention.startAt.slice(0, 10) >= referenceKey && intervention.status !== "cancelled")
    .sort((left, right) => left.startAt!.localeCompare(right.startAt!))[0];
}

export function maintenanceCollectionSummary(periods: MaintenanceBillingPeriod[], reference = new Date()) {
  const referenceKey = dateKey(reference);
  return periods.reduce((summary, period) => {
    if (period.status === "cancelled") return summary;
    summary.total += period.amount;
    if (period.status === "paid") summary.paid += period.amount;
    else if (period.dueOn < referenceKey) summary.overdue += period.amount;
    else summary.upcoming += period.amount;
    return summary;
  }, { total: 0, paid: 0, overdue: 0, upcoming: 0 });
}

export function maintenanceRouteGroups(
  interventions: Intervention[],
  contracts: MaintenanceContract[],
  clients: Client[],
  reference = new Date(),
  horizonDays = 60,
): MaintenanceRouteGroup[] {
  const firstDay = dateKey(reference);
  const last = new Date(reference);
  last.setDate(last.getDate() + horizonDays);
  const lastDay = dateKey(last);
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const groups = new Map<string, MaintenanceRouteGroup>();

  for (const intervention of interventions) {
    if (!intervention.maintenanceContractId || !intervention.startAt || intervention.status === "cancelled") continue;
    const date = intervention.startAt.slice(0, 10);
    if (date < firstDay || date > lastDay) continue;
    const contract = contractsById.get(intervention.maintenanceContractId);
    const client = clientsById.get(contract?.clientId ?? intervention.clientId);
    const city = client?.city.trim() || "Ville non renseignée";
    const key = `${date}:${city.toLocaleLowerCase("fr-FR")}`;
    const group = groups.get(key) ?? { key, date, city, interventions: [], totalMinutes: 0 };
    group.interventions.push(intervention);
    group.totalMinutes += intervention.plannedDurationMinutes;
    groups.set(key, group);
  }

  return [...groups.values()].sort((left, right) => left.date.localeCompare(right.date) || right.interventions.length - left.interventions.length);
}

