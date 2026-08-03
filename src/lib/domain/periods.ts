export type DashboardPeriod = "Aujourd’hui" | "Cette semaine" | "Ce mois" | "Mois précédent";
export type CompanyStatsPeriodKey = `year:${number}` | `month:${number}-${string}`;

export interface CompanyStatsPeriod {
  key: CompanyStatsPeriodKey;
  kind: "month" | "year";
  year: number;
  month?: string;
  label: string;
  start: Date;
  end: Date;
  monthKeys: string[];
}

export function getCompanyStatsPeriodOptions(reference = new Date()) {
  const currentYear = reference.getFullYear();
  const formatter = new Intl.DateTimeFormat("fr-FR", { month: "long" });
  return [currentYear, currentYear - 1].map((year) => {
    const latestMonth = year === currentYear ? reference.getMonth() + 1 : 12;
    const options: Array<{ key: CompanyStatsPeriodKey; label: string }> = [{ key: `year:${year}`, label: `Année ${year}` }];
    for (let month = latestMonth; month >= 1; month -= 1) {
      const monthKey = `${year}-${String(month).padStart(2, "0")}` as `${number}-${string}`;
      const monthLabel = formatter.format(new Date(year, month - 1, 1));
      options.push({ key: `month:${monthKey}`, label: `${monthLabel.charAt(0).toUpperCase()}${monthLabel.slice(1)} ${year}` });
    }
    return { year, options };
  });
}

export function getCompanyStatsPeriod(key: CompanyStatsPeriodKey, reference = new Date()): CompanyStatsPeriod {
  if (key.startsWith("month:")) {
    const month = key.slice(6);
    const year = Number(month.slice(0, 4));
    const monthIndex = Number(month.slice(5, 7)) - 1;
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 1);
    const label = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(start);
    return { key, kind: "month", year, month, label: `${label.charAt(0).toUpperCase()}${label.slice(1)}`, start, end, monthKeys: [month] };
  }

  const year = Number(key.slice(5)) || reference.getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  return {
    key: `year:${year}`,
    kind: "year",
    year,
    label: `Année ${year}`,
    start,
    end,
    monthKeys: Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`),
  };
}

export function getPreviousCompanyStatsPeriodKey(period: CompanyStatsPeriod): CompanyStatsPeriodKey {
  if (period.kind === "month" && period.month) {
    return `month:${period.year - 1}-${period.month.slice(5, 7)}`;
  }
  return `year:${period.year - 1}`;
}

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
