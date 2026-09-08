import { describe, expect, it } from "vitest";
import { appointmentSlotDefaults, createPlanningSlot, localPlanningDateTime, planningSlotMinutes, resolvePlanningSlotMember } from "./planning-slot";

describe("création depuis un créneau", () => {
  it("préremplit une heure au clic sans modifier la date reçue", () => {
    const start = new Date("2026-09-06T14:15:00");
    const slot = createPlanningSlot(start, "member-2");
    expect(planningSlotMinutes(slot)).toBe(60);
    expect(slot.memberId).toBe("member-2");
    expect(slot.durationSelected).toBe(false);
    expect(start.getHours()).toBe(14);
    expect(localPlanningDateTime(slot.start)).toBe("2026-09-06T14:15");
  });

  it("conserve les deux bornes d’une sélection horaire", () => {
    const slot = createPlanningSlot(new Date("2026-09-06T10:15:00"), "member-1", new Date("2026-09-06T13:45:00"));
    expect(planningSlotMinutes(slot)).toBe(210);
    expect(slot.durationSelected).toBe(true);
    expect(appointmentSlotDefaults(slot).durationMinutes).toBe(210);
  });

  it("conserve la fin exclusive d’une absence de plusieurs jours", () => {
    const slot = createPlanningSlot(new Date("2026-09-06T00:00:00"), "member-1", new Date("2026-09-09T00:00:00"), true);
    expect(localPlanningDateTime(slot.end)).toBe("2026-09-09T00:00");
    const appointment = appointmentSlotDefaults(slot);
    expect(localPlanningDateTime(appointment.start)).toBe("2026-09-06T09:00");
    expect(appointment.durationMinutes).toBe(60);
  });

  it("crée une journée entière avec une fin au lendemain", () => {
    const slot = createPlanningSlot(new Date("2026-09-06T15:00:00"), "member-1", undefined, true);
    expect(localPlanningDateTime(slot.start)).toBe("2026-09-06T00:00");
    expect(localPlanningDateTime(slot.end)).toBe("2026-09-07T00:00");
  });

  it("privilégie le collaborateur filtré, puis soi-même, sans choisir un inactif", () => {
    const members = [{ id: "a", active: true }, { id: "b", active: true }, { id: "c", active: false }];
    expect(resolvePlanningSlotMember(members, "b", "a")).toBe("b");
    expect(resolvePlanningSlotMember(members, "all", "b")).toBe("b");
    expect(resolvePlanningSlotMember(members, "c", "a")).toBe("a");
    expect(resolvePlanningSlotMember([], "all", "a")).toBeUndefined();
    expect(resolvePlanningSlotMember([members[0]!], "b", "a")).toBe("a");
  });
});
