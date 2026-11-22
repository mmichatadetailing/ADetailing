import { averageHourlyMargin, companyCollectedRevenue, grossMargin } from "./calculations";
import { financialDateKey, inReportingPeriod } from "./periods";
import type { Intervention, Payment } from "./types";

/** The receipt date drives the objective; the service date drives operational performance. */
export function periodPerformance(interventions: Intervention[], payments: Payment[], period: string, now: Date, throughDay?: string) {
  const includes = (value?: string) => inReportingPeriod(value, period, now) && (!throughDay || financialDateKey(value!) <= throughDay);
  const completed = interventions.filter(job => job.status === "completed" && includes(job.startAt));
  const periodPayments = payments.filter(payment => includes(payment.paidAt));
  const revenue = completed.reduce((sum, job) => sum + job.items.reduce((total, item) => total + item.revenueAllocated, 0), 0);
  return { completed, periodPayments, collected: companyCollectedRevenue(interventions.filter(job => job.status !== "cancelled"), periodPayments),
    margin: completed.reduce((sum, job) => sum + grossMargin(job), 0), hourly: averageHourlyMargin(completed),
    basket: completed.length ? Math.round(revenue / completed.length) : 0 };
}
