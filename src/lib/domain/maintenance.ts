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

export function maintenanceMonthlyRevenue(contract: Pick<MaintenanceContract, "billingFrequency" | "billingAmount">) {
  return contract.billingFrequency === "monthly" ? contract.billingAmount : Math.round(contract.billingAmount / 12);
}

export function maintenanceAnnualValue(contract: Pick<MaintenanceContract, "billingFrequency" | "billingAmount">) {
  return contract.billingFrequency === "monthly" ? contract.billingAmount * 12 : contract.billingAmount;
}

export function maintenanceSchedule(
  contract: Pick<MaintenanceContract, "firstVisitOn" | "visitDay" | "endsOn" | "billingFrequency" | "billingAmount">,
  through: string,
): MaintenanceScheduleEntry[] {
  const firstMonth = contract.firstVisitOn.slice(0, 7);
  const lastMonth = through.slice(0, 7);
  const result: MaintenanceScheduleEntry[] = [];

  for (let month = firstMonth, index = 0; month <= lastMonth; month = monthOffset(firstMonth, ++index)) {
    const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
    const visitOn = `${month}-${String(Math.min(contract.visitDay, lastDay)).padStart(2, "0")}`;
    if (visitOn < contract.firstVisitOn || (contract.endsOn && visitOn > contract.endsOn)) continue;
    const billingDue = contract.billingFrequency === "monthly" || index % 12 === 0;
    const recognizedRevenue = contract.billingFrequency === "monthly"
      ? contract.billingAmount
      : Math.floor(contract.billingAmount / 12) + (index % 12 < contract.billingAmount % 12 ? 1 : 0);
    result.push({ month, visitOn, billingDue, billingAmount: billingDue ? contract.billingAmount : 0, recognizedRevenue });
  }
  return result;
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

