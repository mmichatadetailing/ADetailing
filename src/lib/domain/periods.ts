export type DashboardPeriod = "Aujourd’hui" | "Cette semaine" | "Ce mois" | "Mois précédent";

export function getPeriodRange(period: DashboardPeriod, reference = new Date()) {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);

  if (period === "Cette semaine") {
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
  } else if (period === "Ce mois") {
    start.setDate(1);
  } else if (period === "Mois précédent") {
    start.setDate(1);
    start.setMonth(start.getMonth() - 1);
  }

  const end = new Date(start);
  if (period === "Aujourd’hui") end.setDate(end.getDate() + 1);
  else if (period === "Cette semaine") end.setDate(end.getDate() + 7);
  else end.setMonth(end.getMonth() + 1);

  return { start, end };
}

export function isDateInRange(value: string | undefined, range: { start: Date; end: Date }) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= range.start.getTime() && timestamp < range.end.getTime();
}

export function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function dateKey(date: Date) {
  return `${monthKey(date)}-${String(date.getDate()).padStart(2, "0")}`;
}
