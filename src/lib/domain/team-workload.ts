import { financialDateKey } from "./periods";
import type { Intervention } from "./types";

const parisClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function parisMidnight(utcDay: Date) {
  const [h, m] = parisClock.format(utcDay).split(":").map(Number);
  return utcDay.getTime() - (h! * 60 + m!) * 60_000;
}

/** Assigned person-minutes, Monday to Sunday in Paris. Split a job crossing the week boundary. */
export function weeklyWorkload(jobs: Pick<Intervention, "status" | "startAt" | "endAt" | "workers" | "plannedDurationMinutes">[], now = new Date()) {
  const monday = new Date(financialDateKey(now.toISOString()) + "T00:00:00Z");
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const start = parisMidnight(monday);
  monday.setUTCDate(monday.getUTCDate() + 7);
  const end = parisMidnight(monday);
  const minutes = new Map<string, number>();
  for (const job of jobs) {
    if (!job.startAt || job.status === "cancelled" || job.status === "to_schedule") continue;
    const from = Date.parse(job.startAt);
    const to = job.endAt ? Date.parse(job.endAt) : from + job.plannedDurationMinutes * 60_000;
    const share = to > from ? Math.max(0, Math.min(to, end) - Math.max(from, start)) / (to - from) : Number(from >= start && from < end);
    if (!share) continue;
    for (const worker of job.workers) minutes.set(worker.memberId, (minutes.get(worker.memberId) ?? 0) + worker.plannedMinutes * share);
  }
  return minutes;
}
