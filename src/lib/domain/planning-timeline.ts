export const PLANNING_START_HOUR = 7;
export const PLANNING_END_HOUR = 20;
export const PLANNING_SLOT_MINUTES = 15;

export function startOfPlanningWeek(reference: Date) {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

export function planningDays(weekStart: Date, count: 5 | 7) {
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + index);
    return day;
  });
}

export function isSamePlanningDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

export function dateAtPlanningPosition(day: Date, ratio: number) {
  const totalMinutes = (PLANNING_END_HOUR - PLANNING_START_HOUR) * 60;
  const rawMinutes = Math.max(0, Math.min(totalMinutes - PLANNING_SLOT_MINUTES, ratio * totalMinutes));
  const roundedMinutes = Math.round(rawMinutes / PLANNING_SLOT_MINUTES) * PLANNING_SLOT_MINUTES;
  const result = new Date(day);
  result.setHours(PLANNING_START_HOUR, roundedMinutes, 0, 0);
  return result;
}

export function planningTimelinePosition(startValue: string, endValue: string, day: Date) {
  const rangeStart = new Date(day);
  rangeStart.setHours(PLANNING_START_HOUR, 0, 0, 0);
  const rangeEnd = new Date(day);
  rangeEnd.setHours(PLANNING_END_HOUR, 0, 0, 0);
  const start = new Date(startValue);
  const end = new Date(endValue);
  const visibleStart = Math.max(start.getTime(), rangeStart.getTime());
  const visibleEnd = Math.min(end.getTime(), rangeEnd.getTime());
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || visibleEnd <= visibleStart) return null;
  const duration = rangeEnd.getTime() - rangeStart.getTime();
  return {
    left: (visibleStart - rangeStart.getTime()) / duration * 100,
    width: (visibleEnd - visibleStart) / duration * 100,
  };
}
