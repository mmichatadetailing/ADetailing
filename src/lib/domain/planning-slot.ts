export type PlanningSlot = {
  start: Date;
  end: Date;
  allDay: boolean;
  memberId: string;
  durationSelected: boolean;
};

export function createPlanningSlot(start: Date, memberId: string, end?: Date, allDay = false): PlanningSlot {
  const first = new Date(start);
  if (allDay) first.setHours(0, 0, 0, 0);
  const last = end && end > first ? new Date(end) : new Date(first);
  if (!end || end <= first) {
    if (allDay) last.setDate(last.getDate() + 1);
    else last.setMinutes(last.getMinutes() + 60);
  }
  return { start: first, end: last, allDay, memberId, durationSelected: Boolean(end && end > first) };
}

export function planningSlotMinutes(slot: Pick<PlanningSlot, "start" | "end">) {
  return Math.round((slot.end.getTime() - slot.start.getTime()) / 60_000);
}

// A day cell carries dates, not a service duration. Start with an editable hour at 09:00.
export function appointmentSlotDefaults(slot: PlanningSlot) {
  const start = new Date(slot.start);
  if (slot.allDay) start.setHours(9, 0, 0, 0);
  return { start, durationMinutes: slot.allDay ? 60 : planningSlotMinutes(slot), memberId: slot.memberId };
}

export function localPlanningDateTime(value: Date | string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function resolvePlanningSlotMember(members: Array<{ id: string; active: boolean }>, filter: string, currentUserId?: string) {
  return members.find((member) => member.active && member.id === filter)?.id
    ?? members.find((member) => member.active && member.id === currentUserId)?.id
    ?? members.find((member) => member.active)?.id;
}
