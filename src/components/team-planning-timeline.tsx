"use client";

import { CalendarDays, Clock3, GripVertical } from "lucide-react";
import type { DragEvent, MouseEvent } from "react";
import { useEffect, useRef } from "react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { interventionStatusLabels } from "@/lib/domain/labels";
import {
  dateAtPlanningPosition,
  isSamePlanningDay,
  PLANNING_END_HOUR,
  PLANNING_START_HOUR,
  planningTimelinePosition,
} from "@/lib/domain/planning-timeline";
import type { Client, Intervention, PlanningEvent, TeamMember } from "@/lib/domain/types";
import type { GooglePlanningEvent } from "@/lib/integrations/google-calendar-types";
import { cn, formatDate } from "@/lib/utils";

const RESOURCE_WIDTH = 220;
const DEFAULT_DAY_WIDTH = 455;
const ROW_HEIGHT = 112;
const HOURS = Array.from({ length: PLANNING_END_HOUR - PLANNING_START_HOUR + 1 }, (_, index) => PLANNING_START_HOUR + index);
const DRAG_TYPE = "application/x-adetailing-intervention";

type DragPayload = { interventionId: string; sourceMemberId?: string };
const planningKindLabels: Record<PlanningEvent["kind"], string> = {
  meeting: "Réunion",
  unavailability: "Indisponibilité",
  absence: "Absence",
  personal: "Bloc personnel",
};

function transparentColor(color: string, alpha: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : "#f9734f18";
}

function externalPosition(start: string, end: string, allDay: boolean, day: Date) {
  if (!allDay) return planningTimelinePosition(start, end, day);
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const eventStart = new Date(start);
  const eventEnd = new Date(end);
  return eventStart < dayEnd && dayStart < eventEnd ? { left: 0, width: 100 } : null;
}

function eventBoundaries(start: string, end: string, allDay = false) {
  return {
    start: new Date(allDay ? `${start.slice(0, 10)}T00:00:00` : start).getTime(),
    end: new Date(allDay ? `${end.slice(0, 10)}T00:00:00` : end).getTime(),
  };
}

function dayEvents(memberId: string, day: Date, interventions: Intervention[], googleEvents: GooglePlanningEvent[], planningEvents: PlanningEvent[]) {
  const interventionEvents = interventions
    .filter((intervention) => intervention.startAt && intervention.endAt && intervention.workers.some((worker) => worker.memberId === memberId))
    .map((intervention) => ({ kind: "intervention" as const, intervention, position: planningTimelinePosition(intervention.startAt!, intervention.endAt!, day) }))
    .filter((entry): entry is { kind: "intervention"; intervention: Intervention; position: { left: number; width: number } } => Boolean(entry.position));
  const externalEvents = googleEvents
    .filter((event) => event.memberId === memberId)
    .map((googleEvent) => ({ kind: "google" as const, googleEvent, position: externalPosition(googleEvent.start, googleEvent.end, googleEvent.allDay, day) }))
    .filter((entry): entry is { kind: "google"; googleEvent: GooglePlanningEvent; position: { left: number; width: number } } => Boolean(entry.position));
  const internalEvents = planningEvents
    .filter((event) => event.memberIds.includes(memberId))
    .map((planningEvent) => ({ kind: "planning" as const, planningEvent, position: externalPosition(planningEvent.startAt, planningEvent.endAt, planningEvent.allDay, day) }))
    .filter((entry): entry is { kind: "planning"; planningEvent: PlanningEvent; position: { left: number; width: number } } => Boolean(entry.position));
  const events = [...interventionEvents, ...externalEvents, ...internalEvents].sort((left, right) => {
    const leftStart = left.kind === "intervention" ? left.intervention.startAt! : left.kind === "google" ? left.googleEvent.start : left.planningEvent.startAt;
    const rightStart = right.kind === "intervention" ? right.intervention.startAt! : right.kind === "google" ? right.googleEvent.start : right.planningEvent.startAt;
    return leftStart.localeCompare(rightStart);
  });

  const laneEnds: number[] = [];
  return events.map((entry) => {
    const boundaries = entry.kind === "intervention"
      ? eventBoundaries(entry.intervention.startAt!, entry.intervention.endAt!)
      : entry.kind === "google"
        ? eventBoundaries(entry.googleEvent.start, entry.googleEvent.end, entry.googleEvent.allDay)
        : eventBoundaries(entry.planningEvent.startAt, entry.planningEvent.endAt, entry.planningEvent.allDay);
    const { start, end } = boundaries;
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end;
    return { ...entry, lane: Math.min(lane, 1) };
  });
}

export function TeamPlanningTimeline({
  members,
  interventions,
  googleEvents,
  planningEvents,
  clients,
  days,
  conflictIds,
  googleConflictIds,
  planningConflictIds,
  currentUserId,
  onSelect,
  onSelectGoogle,
  onSelectPlanningEvent,
  onMove,
  onEmptySlot,
  dayWidth = DEFAULT_DAY_WIDTH,
  showDayLabels = true,
}: {
  members: TeamMember[];
  interventions: Intervention[];
  googleEvents: GooglePlanningEvent[];
  planningEvents: PlanningEvent[];
  clients: Client[];
  days: Date[];
  conflictIds: Set<string>;
  googleConflictIds: Set<string>;
  planningConflictIds: Set<string>;
  currentUserId?: string;
  onSelect: (intervention: Intervention) => void;
  onSelectGoogle: (event: GooglePlanningEvent) => void;
  onSelectPlanningEvent: (event: PlanningEvent) => void;
  onMove: (payload: DragPayload, targetMemberId: string, start: Date) => void;
  onEmptySlot: (memberId: string, start: Date) => void;
  dayWidth?: number;
  showDayLabels?: boolean;
}) {
  const today = new Date();
  const timelineWidth = days.length * dayWidth;
  const scrollContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollContainer.current;
    const firstDay = days[0];
    if (!container || !firstDay) return;
    const focusNow = new Date();
    const starts = [
      ...interventions.map((event) => event.startAt),
      ...planningEvents.filter((event) => !event.allDay).map((event) => event.startAt),
      ...googleEvents.filter((event) => !event.allDay).map((event) => event.start),
    ]
      .filter((start): start is string => Boolean(start) && isSamePlanningDay(new Date(start!), firstDay))
      .map((start) => new Date(start))
      .sort((left, right) => left.getTime() - right.getTime());
    const reference = isSamePlanningDay(focusNow, firstDay) ? focusNow : starts[0];
    const minutes = reference ? reference.getHours() * 60 + reference.getMinutes() - 60 : PLANNING_START_HOUR * 60;
    const ratio = Math.max(0, Math.min(1, (minutes - PLANNING_START_HOUR * 60) / ((PLANNING_END_HOUR - PLANNING_START_HOUR) * 60)));
    const viewportOffset = Math.max(80, (container.clientWidth - RESOURCE_WIDTH) / 3);
    const target = Math.max(0, RESOURCE_WIDTH + ratio * dayWidth - viewportOffset);
    const frame = window.requestAnimationFrame(() => container.scrollTo({ left: target, behavior: "smooth" }));
    return () => window.cancelAnimationFrame(frame);
  }, [dayWidth, days, googleEvents, interventions, planningEvents]);

  const readDrag = (event: DragEvent) => {
    try {
      return JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as DragPayload;
    } catch {
      return null;
    }
  };

  const dateFromPointer = (event: DragEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>, day: Date) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return dateAtPlanningPosition(day, (event.clientX - bounds.left) / bounds.width);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_18px_55px_rgba(78,64,120,.08)]">
      <div ref={scrollContainer} className="max-h-[70dvh] overflow-auto">
        <div style={{ minWidth: RESOURCE_WIDTH + timelineWidth }}>
          <div className="sticky top-0 z-30 flex border-b border-zinc-200 bg-white/95 shadow-sm backdrop-blur-xl">
            <div className="sticky left-0 z-40 flex shrink-0 items-center gap-2 border-r border-zinc-200 bg-white px-4" style={{ width: RESOURCE_WIDTH }}>
              <CalendarDays className="size-4 text-brand-500" />
              <div><p className="text-xs font-extrabold text-zinc-900">Collaborateurs</p><p className="text-[10px] text-zinc-500">Équipe & disponibilité</p></div>
            </div>
            <div className="flex" style={{ width: timelineWidth }}>
              {days.map((day) => {
                const todayDay = isSamePlanningDay(day, today);
                return (
                  <div key={day.toISOString()} className={cn("shrink-0 border-r border-zinc-200", todayDay && "bg-orange-50/55")} style={{ width: dayWidth }}>
                    {showDayLabels && <div className="flex h-12 items-center justify-between border-b border-zinc-100 px-4">
                      <div><p className={cn("text-xs font-extrabold capitalize", todayDay ? "text-brand-700" : "text-zinc-900")}>{formatDate(day.toISOString(), { weekday: "long" })}</p><p className="text-[10px] text-zinc-500">{formatDate(day.toISOString(), { day: "2-digit", month: "long" })}</p></div>
                      {todayDay && <Badge variant="orange">Aujourd’hui</Badge>}
                    </div>}
                    <div className={cn("relative", showDayLabels ? "h-8" : "h-11")}>
                      {HOURS.map((hour) => <span key={hour} className="absolute top-2 text-[9px] font-bold text-zinc-500" style={{ left: `${(hour - PLANNING_START_HOUR) / (PLANNING_END_HOUR - PLANNING_START_HOUR) * 100}%`, transform: hour === PLANNING_START_HOUR ? "translateX(8px)" : hour === PLANNING_END_HOUR ? "translateX(calc(-100% - 8px))" : "translateX(-50%)" }}>{hour}h</span>)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex h-10 border-b border-violet-200 bg-gradient-to-r from-violet-50 to-sky-50">
            <div className="sticky left-0 z-20 flex shrink-0 items-center border-r border-violet-200 bg-violet-50 px-4 text-xs font-extrabold text-violet-800" style={{ width: RESOURCE_WIDTH }}>Équipe ADetailing</div>
            <div className="flex items-center px-4 text-[10px] font-semibold text-violet-700" style={{ width: timelineWidth }}>{members.length} personne(s) affichée(s) · glissez une prestation pour modifier son horaire ou son affectation</div>
          </div>

          {members.map((member) => (
            <div key={member.id} className="flex border-b border-zinc-200 last:border-b-0" style={{ minHeight: ROW_HEIGHT }}>
              <div className="sticky left-0 z-20 flex shrink-0 items-center gap-3 border-r border-zinc-200 bg-white px-4 shadow-[8px_0_18px_rgba(41,50,71,.035)]" style={{ width: RESOURCE_WIDTH }}>
                <Avatar label={member.initials} color={member.color} />
                <div className="min-w-0"><p className="truncate text-xs font-extrabold text-zinc-900">{member.firstName} {member.lastName}</p><p className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500"><Clock3 className="size-3" /> {new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(member.weeklyCapacityMinutes / 60)} h/semaine</p>{member.id === currentUserId && <p className="mt-1 text-[9px] font-bold text-emerald-700">Votre ligne</p>}</div>
              </div>
              <div className="flex" style={{ width: timelineWidth }}>
                {days.map((day) => {
                  const events = dayEvents(member.id, day, interventions, googleEvents, planningEvents);
                  const todayDay = isSamePlanningDay(day, today);
                  const nowRatio = (today.getHours() * 60 + today.getMinutes() - PLANNING_START_HOUR * 60) / ((PLANNING_END_HOUR - PLANNING_START_HOUR) * 60);
                  return (
                    <div
                      key={`${member.id}-${day.toISOString()}`}
                      className={cn("group/day relative shrink-0 border-r border-zinc-200 transition-colors hover:bg-brand-50/35", todayDay && "bg-orange-50/25")}
                      style={{ width: dayWidth, height: ROW_HEIGHT }}
                      aria-label={`Planning de ${member.firstName} le ${formatDate(day.toISOString())}`}
                      onClick={(event) => onEmptySlot(member.id, dateAtPlanningPosition(day, (event.clientX - event.currentTarget.getBoundingClientRect().left) / event.currentTarget.getBoundingClientRect().width))}
                      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                      onDrop={(event) => { event.preventDefault(); const payload = readDrag(event); if (payload) onMove(payload, member.id, dateFromPointer(event, day)); }}
                    >
                      {HOURS.map((hour) => <span key={hour} className="pointer-events-none absolute inset-y-0 border-l border-zinc-100" style={{ left: `${(hour - PLANNING_START_HOUR) / (PLANNING_END_HOUR - PLANNING_START_HOUR) * 100}%` }} />)}
                      {todayDay && nowRatio >= 0 && nowRatio <= 1 && <span className="pointer-events-none absolute inset-y-0 z-10 w-px bg-red-400" style={{ left: `${nowRatio * 100}%` }}><span className="absolute -left-1 top-0 size-2 rounded-full bg-red-500" /></span>}
                      {events.map((entry) => {
                        const { position, lane } = entry;
                        if (entry.kind === "google") {
                          const { googleEvent } = entry;
                          const conflicted = googleConflictIds.has(googleEvent.id);
                          return (
                            <button
                              key={`${member.id}-${googleEvent.id}`}
                              type="button"
                              title={`${googleEvent.title} · ${googleEvent.calendarName}${googleEvent.location ? ` · ${googleEvent.location}` : ""}`}
                              onClick={(event) => { event.stopPropagation(); onSelectGoogle(googleEvent); }}
                              className={cn("focus-ring absolute z-20 flex h-10 cursor-pointer items-center gap-2 overflow-hidden rounded-xl border border-sky-400 bg-sky-50 px-2 text-left text-sky-950 shadow-[0_7px_18px_rgba(14,165,233,.13)] transition hover:z-30 hover:-translate-y-0.5 hover:bg-sky-100 hover:shadow-[0_12px_28px_rgba(14,165,233,.18)]", !googleEvent.busy && "border-dashed opacity-75", conflicted && "ring-2 ring-red-400")}
                              style={{ left: `${position.left}%`, width: `max(44px, calc(${position.width}% - 5px))`, maxWidth: `calc(${100 - position.left}% - 4px)`, top: 8 + lane * 47 }}
                            >
                              <CalendarDays className="size-3 shrink-0 text-sky-600" />
                              <span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-extrabold">{googleEvent.title}</span><span className="mt-0.5 block truncate text-[9px] font-semibold text-sky-700">{googleEvent.allDay ? "Toute la journée" : `${formatDate(googleEvent.start, { hour: "2-digit", minute: "2-digit" })}–${formatDate(googleEvent.end, { hour: "2-digit", minute: "2-digit" })}`} · Google</span></span>
                            </button>
                          );
                        }

                        if (entry.kind === "planning") {
                          const { planningEvent } = entry;
                          const color = planningEvent.color || "#8b5cf6";
                          return (
                            <button
                              key={`${member.id}-${planningEvent.id}`}
                              type="button"
                              title={`${planningEvent.title} · ${planningKindLabels[planningEvent.kind]}`}
                              onClick={(event) => { event.stopPropagation(); onSelectPlanningEvent(planningEvent); }}
                              className={cn("focus-ring absolute z-20 flex h-10 cursor-pointer items-center gap-2 overflow-hidden rounded-xl border px-2 text-left text-zinc-900 shadow-[0_7px_18px_rgba(76,29,149,.12)] transition hover:z-30 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(76,29,149,.18)]", planningConflictIds.has(planningEvent.id) && "ring-2 ring-red-400")}
                              style={{ left: `${position.left}%`, width: `max(44px, calc(${position.width}% - 5px))`, maxWidth: `calc(${100 - position.left}% - 4px)`, top: 8 + lane * 47, borderColor: color, borderLeftWidth: 4, backgroundColor: transparentColor(color, "1c") }}
                            >
                              <CalendarDays className="size-3 shrink-0" style={{ color }} />
                              <span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-extrabold">{planningEvent.title}</span><span className="mt-0.5 block truncate text-[9px] font-semibold text-zinc-600">{planningEvent.allDay ? "Toute la journée" : `${formatDate(planningEvent.startAt, { hour: "2-digit", minute: "2-digit" })}–${formatDate(planningEvent.endAt, { hour: "2-digit", minute: "2-digit" })}`} · {planningKindLabels[planningEvent.kind]}</span></span>
                            </button>
                          );
                        }

                        const { intervention } = entry;
                        const client = clients.find((clientEntry) => clientEntry.id === intervention.clientId);
                        const conflicted = conflictIds.has(intervention.id);
                        const memberColor = member.color || "#f9734f";
                        return (
                          <button
                            key={`${member.id}-${intervention.id}`}
                            draggable
                            type="button"
                            title={`${client?.company || `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim()} · ${intervention.title} · ${formatDate(intervention.startAt, { hour: "2-digit", minute: "2-digit" })}`}
                            onClick={(event) => { event.stopPropagation(); onSelect(intervention); }}
                            onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ interventionId: intervention.id, sourceMemberId: member.id } satisfies DragPayload)); }}
                            className={cn("focus-ring absolute z-20 flex h-10 cursor-grab items-center gap-2 overflow-hidden rounded-xl border px-2 text-left shadow-[0_7px_18px_rgba(47,40,72,.11)] transition hover:z-30 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(47,40,72,.17)] active:cursor-grabbing", conflicted && "ring-2 ring-red-400")}
                            style={{ left: `${position.left}%`, width: `max(44px, calc(${position.width}% - 5px))`, maxWidth: `calc(${100 - position.left}% - 4px)`, top: 8 + lane * 47, borderColor: memberColor, borderLeftWidth: 4, backgroundColor: transparentColor(memberColor, "1f"), color: "#172033" }}
                          >
                            <GripVertical className="size-3 shrink-0 opacity-45" />
                            <span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-extrabold">{client?.company || client?.firstName || "Client"} · {intervention.title.split("—")[0]?.trim()}</span><span className="mt-0.5 block truncate text-[9px] font-semibold opacity-65">{formatDate(intervention.startAt, { hour: "2-digit", minute: "2-digit" })}–{formatDate(intervention.endAt, { hour: "2-digit", minute: "2-digit" })} · {interventionStatusLabels[intervention.status]}</span></span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {members.length === 0 && <div className="grid min-h-40 place-items-center text-sm text-zinc-500">Aucun collaborateur à afficher.</div>}
        </div>
      </div>
    </div>
  );
}

export const planningDragType = DRAG_TYPE;
