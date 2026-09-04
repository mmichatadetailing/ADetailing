import { describe, expect, it } from "vitest";
import { planningEventConflicts } from "./planning-events";
import type { Intervention, PlanningEvent } from "./types";

const planningEvent = {
  id: "event-1",
  memberIds: ["member-1"],
  startAt: "2026-09-04T09:00:00.000Z",
  endAt: "2026-09-04T10:00:00.000Z",
} as PlanningEvent;

const intervention = {
  id: "intervention-1",
  workers: [{ memberId: "member-1", plannedMinutes: 60 }],
  startAt: "2026-09-04T09:30:00.000Z",
  endAt: "2026-09-04T10:30:00.000Z",
} as Intervention;

describe("conflits des événements de planning", () => {
  it("détecte un chevauchement avec une prestation du même collaborateur", () => {
    const result = planningEventConflicts([intervention], [planningEvent], []);
    expect(result.count).toBe(1);
    expect(result.interventionIds.has(intervention.id)).toBe(true);
    expect(result.planningEventIds.has(planningEvent.id)).toBe(true);
  });

  it("ignore les événements de collaborateurs différents", () => {
    const result = planningEventConflicts([intervention], [{ ...planningEvent, memberIds: ["member-2"] }], []);
    expect(result.count).toBe(0);
  });
});
