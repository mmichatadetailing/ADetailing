import { describe, expect, it } from "vitest";
import { planningEventConflicts, planningMoveConflicts } from "./planning-events";
import type { Intervention, PlanningEvent } from "./types";
import type { GooglePlanningEvent } from "../integrations/google-calendar-types";

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

describe("contrôle d’un déplacement", () => {
  const candidate = {
    id: "intervention-moving",
    source: "intervention" as const,
    title: "Prestation déplacée",
    startAt: "2026-09-04T09:00:00.000Z",
    endAt: "2026-09-04T10:00:00.000Z",
    memberIds: ["member-1"],
  };

  it("ignore l’élément déplacé mais détecte les autres créneaux du collaborateur", () => {
    const moving = { ...intervention, id: candidate.id };
    const result = planningMoveConflicts(candidate, [moving, intervention], [], []);
    expect(result.map((conflict) => conflict.id)).toEqual([intervention.id]);
  });

  it("détecte les événements internes et Google occupés", () => {
    const googleEvent = {
      id: "google-1",
      title: "Rendez-vous Google",
      memberId: "member-1",
      start: "2026-09-04T09:15:00.000Z",
      end: "2026-09-04T09:45:00.000Z",
      busy: true,
    } as GooglePlanningEvent;
    const result = planningMoveConflicts(candidate, [], [planningEvent], [googleEvent]);
    expect(result.map((conflict) => conflict.source)).toEqual(["planning", "google"]);
  });

  it("ignore Google lorsqu’un événement est marqué disponible", () => {
    const availableEvent = {
      id: "google-free",
      title: "Information",
      memberId: "member-1",
      start: "2026-09-04T09:15:00.000Z",
      end: "2026-09-04T09:45:00.000Z",
      busy: false,
    } as GooglePlanningEvent;
    expect(planningMoveConflicts(candidate, [], [], [availableEvent])).toEqual([]);
  });
});
