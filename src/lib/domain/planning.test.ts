import { describe, expect, it } from "vitest";
import { canViewTeamPlanning, filterPlanningForUser } from "./planning";

const interventions = [
  { id: "alban", workers: [{ memberId: "alban" }] },
  { id: "shared", workers: [{ memberId: "alban" }, { memberId: "melvyn" }] },
  { id: "melvyn", workers: [{ memberId: "melvyn" }] },
  { id: "unassigned", workers: [] },
];

describe("visibilité du planning", () => {
  it("donne la vue équipe aux administrateurs et aux associés", () => {
    expect(canViewTeamPlanning("admin")).toBe(true);
    expect(canViewTeamPlanning("partner")).toBe(true);
  });

  it("limite les collaborateurs à leur planning", () => {
    expect(canViewTeamPlanning("employee")).toBe(false);
    expect(filterPlanningForUser(interventions, { canViewTeam: false, userId: "melvyn" }).map((item) => item.id)).toEqual(["shared", "melvyn"]);
  });

  it("ne montre rien à un collaborateur dont l’identité manque", () => {
    expect(filterPlanningForUser(interventions, { canViewTeam: false })).toEqual([]);
  });

  it("conserve la vue complète en démonstration", () => {
    expect(canViewTeamPlanning(undefined, true)).toBe(true);
    expect(filterPlanningForUser(interventions, { canViewTeam: true })).toBe(interventions);
  });
});
