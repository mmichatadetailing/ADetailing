import { describe, expect, it } from "vitest";
import { canManageBusiness, canOperateAssignedWork } from "./permissions";

describe("permissions", () => {
  it.each(["admin", "partner"] as const)("autorise %s à piloter l'entreprise", (role) => {
    expect(canManageBusiness(role)).toBe(true);
  });

  it("réserve la gestion métier aux responsables", () => {
    expect(canManageBusiness("employee")).toBe(false);
  });

  it("limite un employé aux prestations qui lui sont affectées", () => {
    expect(canOperateAssignedWork("employee", true)).toBe(true);
    expect(canOperateAssignedWork("employee", false)).toBe(false);
    expect(canOperateAssignedWork("partner", false)).toBe(true);
  });
});
