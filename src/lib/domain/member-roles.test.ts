import { describe, expect, it } from "vitest";
import { memberRoleDisplayLabel, memberRoleDisplayVariant } from "./member-roles";

describe("affichage des rôles d'équipe", () => {
  it("présente l'administrateur comme un associé sans changer son rôle technique", () => {
    expect(memberRoleDisplayLabel("admin")).toBe("Associé");
    expect(memberRoleDisplayVariant("admin")).toBe("blue");
  });

  it("conserve les libellés métier des autres membres", () => {
    expect(memberRoleDisplayLabel("partner")).toBe("Associé");
    expect(memberRoleDisplayLabel("employee")).toBe("Collaborateur");
  });
});
