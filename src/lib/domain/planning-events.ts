import type { Intervention, PlanningEvent } from "@/lib/domain/types";
import type { GooglePlanningEvent } from "@/lib/integrations/google-calendar-types";

export const planningEventKindLabels: Record<PlanningEvent["kind"], string> = {
  meeting: "Réunion",
  unavailability: "Indisponibilité",
  absence: "Absence",
  personal: "Bloc personnel",
};

function overlaps(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return new Date(leftStart) < new Date(rightEnd) && new Date(rightStart) < new Date(leftEnd);
}

function sharesMember(left: string[], right: string[]) {
  return left.some((memberId) => right.includes(memberId));
}

export interface PlanningMoveCandidate {
  id: string;
  source: "intervention" | "planning";
  title: string;
  startAt: string;
  endAt: string;
  memberIds: string[];
}

export interface PlanningMoveConflict {
  id: string;
  source: "intervention" | "planning" | "google";
  title: string;
  startAt: string;
  endAt: string;
}

/**
 * Lists the busy items that a proposed calendar move would overlap. The moving
 * item itself is excluded so this can be used before the optimistic update.
 */
export function planningMoveConflicts(
  candidate: PlanningMoveCandidate,
  interventions: Intervention[],
  planningEvents: PlanningEvent[],
  googleEvents: GooglePlanningEvent[],
) {
  const conflicts: PlanningMoveConflict[] = [];

  for (const intervention of interventions) {
    if (
      candidate.source === "intervention" && intervention.id === candidate.id
      || intervention.status === "cancelled"
      || !intervention.startAt
      || !intervention.endAt
      || !sharesMember(candidate.memberIds, intervention.workers.map((worker) => worker.memberId))
      || !overlaps(candidate.startAt, candidate.endAt, intervention.startAt, intervention.endAt)
    ) continue;
    conflicts.push({ id: intervention.id, source: "intervention", title: intervention.title, startAt: intervention.startAt, endAt: intervention.endAt });
  }

  for (const event of planningEvents) {
    if (
      candidate.source === "planning" && event.id === candidate.id
      || !sharesMember(candidate.memberIds, event.memberIds)
      || !overlaps(candidate.startAt, candidate.endAt, event.startAt, event.endAt)
    ) continue;
    conflicts.push({ id: event.id, source: "planning", title: event.title, startAt: event.startAt, endAt: event.endAt });
  }

  for (const event of googleEvents) {
    if (
      !event.busy
      || !candidate.memberIds.includes(event.memberId)
      || !overlaps(candidate.startAt, candidate.endAt, event.start, event.end)
    ) continue;
    conflicts.push({ id: event.id, source: "google", title: event.title, startAt: event.start, endAt: event.end });
  }

  return conflicts.sort((left, right) => left.startAt.localeCompare(right.startAt) || left.title.localeCompare(right.title));
}

export function planningEventConflicts(
  interventions: Intervention[],
  planningEvents: PlanningEvent[],
  googleEvents: GooglePlanningEvent[],
) {
  const interventionIds = new Set<string>();
  const planningEventIds = new Set<string>();
  const googleEventIds = new Set<string>();
  let count = 0;

  for (const event of planningEvents) {
    for (const intervention of interventions) {
      if (!intervention.startAt || !intervention.endAt || !sharesMember(event.memberIds, intervention.workers.map((worker) => worker.memberId))) continue;
      if (!overlaps(event.startAt, event.endAt, intervention.startAt, intervention.endAt)) continue;
      planningEventIds.add(event.id);
      interventionIds.add(intervention.id);
      count += 1;
    }
    for (const googleEvent of googleEvents) {
      if (!googleEvent.busy || !event.memberIds.includes(googleEvent.memberId) || !overlaps(event.startAt, event.endAt, googleEvent.start, googleEvent.end)) continue;
      planningEventIds.add(event.id);
      googleEventIds.add(googleEvent.id);
      count += 1;
    }
  }

  for (let index = 0; index < planningEvents.length; index += 1) {
    const event = planningEvents[index]!;
    for (const other of planningEvents.slice(index + 1)) {
      if (!sharesMember(event.memberIds, other.memberIds) || !overlaps(event.startAt, event.endAt, other.startAt, other.endAt)) continue;
      planningEventIds.add(event.id);
      planningEventIds.add(other.id);
      count += 1;
    }
  }

  return { interventionIds, planningEventIds, googleEventIds, count };
}
