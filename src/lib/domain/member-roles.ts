import type { MemberRole } from "./types";

export function memberRoleDisplayLabel(role: MemberRole) {
  return role === "employee" ? "Collaborateur" : "Associé";
}

export function memberRoleDisplayVariant(role: MemberRole): "blue" | "neutral" {
  return role === "employee" ? "neutral" : "blue";
}
