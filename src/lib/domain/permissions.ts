import type { MemberRole } from "@/lib/domain/types";

export function canManageBusiness(role: MemberRole) {
  return role === "admin" || role === "partner";
}

export function canOperateAssignedWork(role: MemberRole, assignedToUser: boolean) {
  return canManageBusiness(role) || (role === "employee" && assignedToUser);
}
