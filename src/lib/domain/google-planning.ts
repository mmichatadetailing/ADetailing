import type { Intervention } from "@/lib/domain/types";
import type { GooglePlanningEvent } from "@/lib/integrations/google-calendar-types";

export type GooglePlanningView = "timeline" | "day" | "week" | "month";

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function googlePlanningRange(selectedDate: Date, view: GooglePlanningView) {
  let start = startOfDay(selectedDate);
  let end = new Date(start);

  if (view === "week") {
    const weekday = start.getDay() || 7;
    start.setDate(start.getDate() - weekday + 1);
    end = new Date(start);
    end.setDate(end.getDate() + 7);
  } else if (view === "month") {
    start = new Date(start.getFullYear(), start.getMonth(), 1);
    start.setDate(start.getDate() - 7);
    end = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1);
    end.setDate(end.getDate() + 7);
  } else {
    end.setDate(end.getDate() + 1);
  }

  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

export function googlePlanningPrefetchRange(selectedDate: Date, view: GooglePlanningView) {
  const visible = googlePlanningRange(selectedDate, view);
  const visibleStart = new Date(visible.timeMin);
  const visibleEnd = new Date(visible.timeMax);
  const periodDuration = visibleEnd.getTime() - visibleStart.getTime();
  return {
    timeMin: new Date(visibleStart.getTime() - periodDuration).toISOString(),
    timeMax: new Date(visibleEnd.getTime() + periodDuration).toISOString(),
  };
}

export function eventOverlapsRange(start: string, end: string, range: { timeMin: string; timeMax: string }) {
  return new Date(start) < new Date(range.timeMax) && new Date(range.timeMin) < new Date(end);
}

function eventBoundary(value: string, allDay: boolean) {
  return new Date(allDay ? `${value.slice(0, 10)}T00:00:00` : value).getTime();
}

export function googlePlanningConflicts(
  interventions: Intervention[],
  googleEvents: GooglePlanningEvent[],
  currentUserId?: string,
) {
  const interventionIds = new Set<string>();
  const googleEventIds = new Set<string>();
  if (!currentUserId) return { interventionIds, googleEventIds, count: 0 };

  for (const intervention of interventions) {
    if (!intervention.startAt || !intervention.endAt || !intervention.workers.some((worker) => worker.memberId === currentUserId)) continue;
    const interventionStart = new Date(intervention.startAt).getTime();
    const interventionEnd = new Date(intervention.endAt).getTime();

    for (const googleEvent of googleEvents) {
      if (!googleEvent.busy || googleEvent.memberId !== currentUserId) continue;
      const googleStart = eventBoundary(googleEvent.start, googleEvent.allDay);
      const googleEnd = eventBoundary(googleEvent.end, googleEvent.allDay);
      if (interventionStart < googleEnd && googleStart < interventionEnd) {
        interventionIds.add(intervention.id);
        googleEventIds.add(googleEvent.id);
      }
    }
  }

  return { interventionIds, googleEventIds, count: googleEventIds.size };
}
