import type { MemberRole } from "./types";

type PlanningItem = {
  workers: Array<{ memberId: string }>;
};

export function canViewTeamPlanning(role: MemberRole | undefined, demoMode = false) {
  return demoMode || role === "admin" || role === "partner";
}

export function filterPlanningForUser<T extends PlanningItem>(
  interventions: T[],
  options: { canViewTeam: boolean; userId?: string },
) {
  if (options.canViewTeam) return interventions;
  if (!options.userId) return [];
  return interventions.filter((intervention) =>
    intervention.workers.some((worker) => worker.memberId === options.userId),
  );
}
