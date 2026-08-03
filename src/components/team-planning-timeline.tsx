"use client";

import { CalendarDays, Clock3, GripVertical } from "lucide-react";
import type { DragEvent, MouseEvent } from "react";
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
import type { Client, Intervention, TeamMember } from "@/lib/domain/types";
import { cn, formatDate } from "@/lib/utils";

const RESOURCE_WIDTH = 220;
const DEFAULT_DAY_WIDTH = 455;
const ROW_HEIGHT = 112;
const HOURS = Array.from({ length: PLANNING_END_HOUR - PLANNING_START_HOUR + 1 }, (_, index) => PLANNING_START_HOUR + index);
const DRAG_TYPE = "application/x-adetailing-intervention";

type DragPayload = { interventionId: string; sourceMemberId?: string };

function transparentColor(color: string, alpha: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : "#f9734f18";
}

function dayEvents(memberId: string, day: Date, interventions: Intervention[]) {
  const events = interventions
    .filter((intervention) => intervention.startAt && intervention.endAt && intervention.workers.some((worker) => worker.memberId === memberId))
    .map((intervention) => ({ intervention, position: planningTimelinePosition(intervention.startAt!, intervention.endAt!, day) }))
    .filter((entry): entry is { intervention: Intervention; position: { left: number; width: number } } => Boolean(entry.position))
    .sort((left, right) => (left.intervention.startAt ?? "").localeCompare(right.intervention.startAt ?? ""));

  const laneEnds: number[] = [];
  return events.map((entry) => {
    const start = new Date(entry.intervention.startAt!).getTime();
    const end = new Date(entry.intervention.endAt!).getTime();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end;
    return { ...entry, lane: Math.min(lane, 1) };
  });
}

export function TeamPlanningTimeline({
  members,
  interventions,
  clients,
  days,
  conflictIds,
  currentUserId,
  onSelect,
  onMove,
  onEmptySlot,
  dayWidth = DEFAULT_DAY_WIDTH,
  showDayLabels = true,
}: {
  members: TeamMember[];
  interventions: Intervention[];
  clients: Client[];
  days: Date[];
  conflictIds: Set<string>;
  currentUserId?: string;
  onSelect: (intervention: Intervention) => void;
  onMove: (payload: DragPayload, targetMemberId: string, start: Date) => void;
  onEmptySlot: (memberId: string, start: Date) => void;
  dayWidth?: number;
  showDayLabels?: boolean;
}) {
  const today = new Date();
  const timelineWidth = days.length * dayWidth;

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
      <div className="max-h-[70dvh] overflow-auto">
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
                  const events = dayEvents(member.id, day, interventions);
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
                      {events.map(({ intervention, position, lane }) => {
                        const client = clients.find((entry) => entry.id === intervention.clientId);
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
