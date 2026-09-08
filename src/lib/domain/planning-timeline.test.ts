import { describe, expect, it } from "vitest";
import { dateAtPlanningPosition, planningDays, planningTimelinePosition, startOfPlanningWeek, planningSelectionRange } from "./planning-timeline";

describe("frise du planning d'équipe", () => {
  it("commence la semaine le lundi", () => {
    const start = startOfPlanningWeek(new Date("2026-08-06T12:00:00"));
    expect(start.getDay()).toBe(1);
    expect(planningDays(start, 5)).toHaveLength(5);
  });

  it("convertit une position horizontale en créneau de quinze minutes", () => {
    const date = dateAtPlanningPosition(new Date("2026-08-03T00:00:00"), 2 / 13);
    expect(date.getHours()).toBe(9);
    expect(date.getMinutes()).toBe(0);
  });

  it("place et tronque visuellement une prestation dans la journée", () => {
    const position = planningTimelinePosition("2026-08-03T06:30:00", "2026-08-03T09:00:00", new Date("2026-08-03"));
    expect(position?.left).toBe(0);
    expect(position?.width).toBeCloseTo(2 / 13 * 100);
    expect(planningTimelinePosition("2026-08-04T09:00:00", "2026-08-04T10:00:00", new Date("2026-08-03"))).toBeNull();
  });

  it("sélectionne aussi de droite à gauche et conserve une durée minimale", () => {
    const range = planningSelectionRange(new Date("2026-09-06T14:00:00"), new Date("2026-09-06T11:30:00"));
    expect(range.start.getHours()).toBe(11);
    expect((range.end.getTime() - range.start.getTime()) / 60_000).toBe(150);
    const same = planningSelectionRange(range.start, range.start);
    expect((same.end.getTime() - same.start.getTime()) / 60_000).toBe(15);
  });

  it("autorise une sélection jusqu’à 20 h sans commencer après 19 h 45", () => {
    const day = new Date("2026-09-06T00:00:00");
    expect(dateAtPlanningPosition(day, 1).getHours()).toBe(19);
    expect(dateAtPlanningPosition(day, 1).getMinutes()).toBe(45);
    expect(dateAtPlanningPosition(day, 1, true).getHours()).toBe(20);
  });
});
