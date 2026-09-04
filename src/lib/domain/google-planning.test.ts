import { describe, expect, it } from "vitest";
import { googlePlanningConflicts, googlePlanningRange } from "./google-planning";
import type { Intervention } from "./types";
import type { GooglePlanningEvent } from "../integrations/google-calendar-types";

const intervention = {
  id: "i-1",
  startAt: "2026-09-04T08:00:00.000Z",
  endAt: "2026-09-04T10:00:00.000Z",
  workers: [{ memberId: "member-1", plannedMinutes: 120 }],
} as Intervention;

const googleEvent = {
  id: "google-1",
  memberId: "member-1",
  start: "2026-09-04T09:00:00.000Z",
  end: "2026-09-04T10:30:00.000Z",
  allDay: false,
  busy: true,
} as GooglePlanningEvent;

describe("google planning", () => {
  it("requests one day for the timeline", () => {
    const range = googlePlanningRange(new Date(2026, 8, 4, 12), "timeline");
    expect(new Date(range.timeMax).getTime() - new Date(range.timeMin).getTime()).toBe(24 * 60 * 60 * 1_000);
  });

  it("starts a weekly request on Monday", () => {
    const range = googlePlanningRange(new Date(2026, 8, 4, 12), "week");
    expect(new Date(range.timeMin).getDay()).toBe(1);
    expect(new Date(range.timeMax).getTime() - new Date(range.timeMin).getTime()).toBe(7 * 24 * 60 * 60 * 1_000);
  });

  it("detects busy Google events for the signed-in member", () => {
    const conflicts = googlePlanningConflicts([intervention], [googleEvent], "member-1");
    expect([...conflicts.interventionIds]).toEqual(["i-1"]);
    expect([...conflicts.googleEventIds]).toEqual(["google-1"]);
    expect(conflicts.count).toBe(1);
  });

  it("does not flag free Google events", () => {
    const conflicts = googlePlanningConflicts([intervention], [{ ...googleEvent, busy: false }], "member-1");
    expect(conflicts.count).toBe(0);
  });
});
