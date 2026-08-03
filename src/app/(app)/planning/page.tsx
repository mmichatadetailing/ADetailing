"use client";

import type { DateSelectArg, EventClickArg, EventDropArg } from "@fullcalendar/core";
import frLocale from "@fullcalendar/core/locales/fr";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { type EventResizeDoneArg } from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus2,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Link2,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { InterventionDetail } from "@/components/intervention-detail";
import { PageHeader } from "@/components/page-header";
import { planningDragType, TeamPlanningTimeline } from "@/components/team-planning-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useWorkspace } from "@/components/workspace-provider";
import { canViewTeamPlanning, filterPlanningForUser } from "@/lib/domain/planning";
import { startOfPlanningWeek } from "@/lib/domain/planning-timeline";
import { dateKey } from "@/lib/domain/periods";
import type { Intervention } from "@/lib/domain/types";
import { useDemoStore } from "@/lib/demo/store";
import { cn, formatDate } from "@/lib/utils";

type CalendarView = "timeline" | "day" | "week" | "month";
type PlanningSlot = { start: Date; memberId: string };
type MovePayload = { interventionId: string; sourceMemberId?: string };

const calendarViews: Array<{ id: CalendarView; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "day", label: "Jour" },
  { id: "week", label: "Semaine" },
  { id: "month", label: "Mois" },
];

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function addToDate(current: Date, view: CalendarView, direction: -1 | 1) {
  const next = new Date(current);
  if (view === "month") next.setMonth(next.getMonth() + direction);
  else next.setDate(next.getDate() + direction * (view === "week" ? 7 : 1));
  return next;
}

function viewTitle(selectedDate: Date, view: CalendarView) {
  if (view === "month") return capitalize(formatDate(selectedDate.toISOString(), { month: "long", year: "numeric" }));
  if (view === "week") {
    const start = startOfPlanningWeek(selectedDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${formatDate(start.toISOString(), { day: "2-digit", month: "long" })} — ${formatDate(end.toISOString(), { day: "2-digit", month: "long", year: "numeric" })}`;
  }
  return capitalize(formatDate(selectedDate.toISOString(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
}

function reassignWorkers(intervention: Intervention, sourceMemberId: string | undefined, targetMemberId: string) {
  const workers = intervention.workers.map((worker) => ({ ...worker }));
  if (sourceMemberId && sourceMemberId !== targetMemberId) {
    if (workers.some((worker) => worker.memberId === targetMemberId)) return workers.filter((worker) => worker.memberId !== sourceMemberId);
    return workers.map((worker) => worker.memberId === sourceMemberId ? { ...worker, memberId: targetMemberId } : worker);
  }
  if (workers.some((worker) => worker.memberId === targetMemberId)) return workers;
  if (workers.length === 0) return [{ memberId: targetMemberId, plannedMinutes: intervention.plannedDurationMinutes }];
  return [{ ...workers[0]!, memberId: targetMemberId }, ...workers.slice(1)];
}

export default function PlanningPage() {
  const data = useDemoStore();
  const { mode, workspace } = useWorkspace();
  const [slot, setSlot] = useState<PlanningSlot | null>(null);
  const [selected, setSelected] = useState<Intervention | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>("timeline");

  const teamPlanning = canViewTeamPlanning(workspace?.role, mode === "demo");
  const currentUserId = workspace?.userId ?? data.team[0]?.id;
  const visibleInterventions = useMemo(
    () => filterPlanningForUser(data.interventions, { canViewTeam: teamPlanning, userId: currentUserId }),
    [currentUserId, data.interventions, teamPlanning],
  );
  const unscheduled = useMemo(
    () => visibleInterventions.filter((item) => !item.startAt && item.status === "to_schedule"),
    [visibleInterventions],
  );
  const scheduled = useMemo(
    () => visibleInterventions.filter((item) => item.startAt && item.endAt && item.status !== "cancelled"),
    [visibleInterventions],
  );
  const planningMembers = useMemo(() => {
    const assignedMemberIds = new Set(visibleInterventions.flatMap((item) => item.workers.map((worker) => worker.memberId)));
    return data.team.filter((member) =>
      (teamPlanning || member.id === currentUserId) && (member.active || assignedMemberIds.has(member.id)),
    );
  }, [currentUserId, data.team, teamPlanning, visibleInterventions]);

  const conflictPairs = useMemo(() => scheduled.flatMap((item, index) => scheduled.slice(index + 1).filter((other) => {
    if (!item.startAt || !item.endAt || !other.startAt || !other.endAt) return false;
    const sameWorker = item.workers.some((worker) => other.workers.some((entry) => entry.memberId === worker.memberId));
    return sameWorker && new Date(item.startAt) < new Date(other.endAt) && new Date(other.startAt) < new Date(item.endAt);
  }).map((other) => [item.id, other.id] as const)), [scheduled]);
  const conflictIds = useMemo(() => new Set(conflictPairs.flat()), [conflictPairs]);

  const events = useMemo(() => scheduled.map((item) => {
    const member = planningMembers.find((entry) => item.workers.some((worker) => worker.memberId === entry.id));
    const client = data.clients.find((entry) => entry.id === item.clientId);
    const clientLabel = client?.company || `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim() || "Client";
    const color = member?.color || "#f9734f";
    return {
      id: item.id,
      title: `${clientLabel} · ${item.title}`,
      start: item.startAt!,
      end: item.endAt!,
      backgroundColor: /^#[0-9a-f]{6}$/i.test(color) ? `${color}24` : "#fff4ed",
      borderColor: color,
      textColor: "#172033",
    };
  }), [data.clients, planningMembers, scheduled]);

  const moveIntervention = (payload: MovePayload, targetMemberId: string, start: Date) => {
    const intervention = visibleInterventions.find((item) => item.id === payload.interventionId);
    if (!intervention) return toast.error("Cette prestation n’est plus disponible dans le planning.");
    const workers = reassignWorkers(intervention, teamPlanning ? payload.sourceMemberId : undefined, targetMemberId);
    data.updateIntervention(intervention.id, {
      clientId: intervention.clientId,
      vehicleId: intervention.vehicleId,
      vehicleFormat: intervention.vehicleFormat,
      title: intervention.title,
      status: intervention.status,
      startAt: start.toISOString(),
      plannedDurationMinutes: intervention.plannedDurationMinutes,
      address: intervention.address,
      notes: intervention.notes,
      workers: workers.map((worker) => ({ memberId: worker.memberId, plannedMinutes: worker.plannedMinutes })),
      items: intervention.items.map((item) => ({ id: item.id, serviceId: item.serviceId, label: item.label, quantity: item.quantity, revenueAllocated: item.revenueAllocated })),
    });
    const member = data.team.find((entry) => entry.id === targetMemberId);
    toast.success("Planning mis à jour", { description: `${formatDate(start.toISOString(), { weekday: "long", hour: "2-digit", minute: "2-digit" })}${teamPlanning && member ? ` · ${member.firstName}` : ""}` });
  };

  const persistDates = (interventionId: string, start: Date | null, end: Date | null) => {
    const intervention = visibleInterventions.find((item) => item.id === interventionId);
    if (!intervention || !start) return;
    const computedEnd = end ?? new Date(start.getTime() + intervention.plannedDurationMinutes * 60_000);
    data.rescheduleIntervention(interventionId, start.toISOString(), computedEnd.toISOString());
    toast.success("Créneau mis à jour", { description: formatDate(start.toISOString(), { weekday: "long", hour: "2-digit", minute: "2-digit" }) });
  };

  const chooseEmptySlot = (memberId: string, start: Date) => {
    if (unscheduled.length === 0) return;
    setSlot({ memberId, start });
  };

  const chooseCalendarSlot = (start: Date) => {
    if (unscheduled.length === 0) return;
    const memberId = currentUserId && planningMembers.some((member) => member.id === currentUserId)
      ? currentUserId
      : planningMembers[0]?.id;
    if (memberId) setSlot({ memberId, start });
  };

  const scheduleInSlot = (intervention: Intervention) => {
    if (!slot) return;
    moveIntervention({ interventionId: intervention.id }, slot.memberId, slot.start);
    setSlot(null);
  };

  const handleDateClick = (date: Date) => {
    if (view === "month") {
      setSelectedDate(date);
      setView("timeline");
      return;
    }
    chooseCalendarSlot(date);
  };

  const fullCalendarView = view === "day" ? "timeGridDay" : view === "week" ? "timeGridWeek" : "dayGridMonth";
  const emptyUnscheduledLabel = teamPlanning
    ? "Toutes les prestations sont planifiées."
    : "Aucune prestation non planifiée ne vous est affectée.";

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={teamPlanning ? "Organisation de l’équipe" : "Mon agenda"}
        title={teamPlanning ? "Planning de l’équipe" : "Mon planning"}
        description={teamPlanning
          ? "Visualisez toute l’équipe sur une seule journée, puis basculez instantanément vers le jour, la semaine ou le mois."
          : "Votre agenda reste centré sur vos propres prestations, avec quatre niveaux de lecture complémentaires."}
        actions={<Link href="/parametres#integrations"><Button variant="secondary"><Link2 className="size-4" /> Connecter Google Calendar</Button></Link>}
      />

      <Card className="overflow-hidden bg-[linear-gradient(120deg,rgba(255,255,255,.98),rgba(255,247,237,.72),rgba(245,243,255,.72))]">
        <CardContent className="p-4 sm:p-5">
          <div className="grid gap-4 xl:grid-cols-[auto_minmax(240px,1fr)_auto] xl:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
                <Button size="sm" variant="ghost" aria-label="Période précédente" onClick={() => setSelectedDate((current) => addToDate(current, view, -1))}><ChevronLeft className="size-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedDate(new Date())}>Aujourd’hui</Button>
                <Button size="sm" variant="ghost" aria-label="Période suivante" onClick={() => setSelectedDate((current) => addToDate(current, view, 1))}><ChevronRight className="size-4" /></Button>
              </div>
              <Input
                type="date"
                aria-label="Aller à une date"
                value={dateKey(selectedDate)}
                onChange={(event) => {
                  const [year, month, day] = event.target.value.split("-").map(Number);
                  if (year && month && day) setSelectedDate(new Date(year, month - 1, day));
                }}
                className="min-h-9 w-[142px] text-zinc-900"
              />
            </div>

            <div className="text-center">
              <h2 className="text-lg font-extrabold capitalize text-zinc-900 sm:text-xl">{viewTitle(selectedDate, view)}</h2>
              <p className="mt-1 text-[11px] text-zinc-500">Créneaux de 15 minutes · journée de 7h à 20h</p>
            </div>

            <div className="flex flex-wrap justify-center gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm xl:justify-end">
              {calendarViews.map((entry) => (
                <Button
                  key={entry.id}
                  size="sm"
                  variant="ghost"
                  aria-pressed={view === entry.id}
                  className={cn(view === entry.id && "bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-sm hover:text-white")}
                  onClick={() => setView(entry.id)}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 xl:justify-end">
            <Badge variant={teamPlanning ? "blue" : "green"}>{teamPlanning ? <UsersRound className="mr-1.5 size-3" /> : <UserRound className="mr-1.5 size-3" />}{teamPlanning ? "Vue équipe" : "Vue personnelle"}</Badge>
            {conflictPairs.length > 0 && <Badge variant="red"><AlertTriangle className="mr-1 size-3" /> {conflictPairs.length} conflit(s)</Badge>}
            <Badge variant="orange">{unscheduled.length} à planifier</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2"><CalendarPlus2 className="size-4 text-brand-500" /><h2 className="text-sm font-bold">{teamPlanning ? "Non planifiées" : "À planifier pour moi"}</h2></div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">{view === "timeline" ? "Glissez une carte sur la ligne d’un collaborateur, au jour et à l’heure souhaités." : "Cliquez sur un créneau pour y placer une prestation, ou déplacez directement un rendez-vous existant."}</p>
              <div className="mt-4 grid gap-2">
                {unscheduled.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-5 text-center text-xs text-zinc-500">{emptyUnscheduledLabel}</p> : unscheduled.map((item) => {
                  const client = data.clients.find((entry) => entry.id === item.clientId);
                  const vehicle = data.vehicles.find((entry) => entry.id === item.vehicleId);
                  return (
                    <button
                      key={item.id}
                      draggable={view === "timeline"}
                      type="button"
                      onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(planningDragType, JSON.stringify({ interventionId: item.id } satisfies MovePayload)); }}
                      onClick={() => setSelected(item)}
                      className={cn("focus-ring surface-interactive rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-sm", view === "timeline" && "cursor-grab active:cursor-grabbing")}
                    >
                      <div className="flex items-start gap-2"><GripVertical className="mt-0.5 size-3.5 text-zinc-400" /><div className="min-w-0"><p className="truncate text-xs font-bold text-zinc-900">{client?.company || `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim()}</p><p className="mt-1 truncate text-[11px] text-zinc-500">{vehicle ? `${vehicle.make} ${vehicle.model}` : item.vehicleFormat || "Véhicule non renseigné"}</p><p className="mt-2 text-[10px] font-bold text-brand-600">{item.plannedDurationMinutes / 60} h · {item.workers.length || 1} pers.</p></div></div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 text-[11px] leading-5 text-sky-800"><strong>Astuce :</strong> cliquez sur une date du mois pour l’ouvrir directement dans la Timeline. Sur mobile, la frise défile horizontalement tout en gardant les collaborateurs visibles.</div>
        </aside>

        <div className="min-w-0">
          {view === "timeline" ? (
            <TeamPlanningTimeline
              members={planningMembers}
              interventions={scheduled}
              clients={data.clients}
              days={[selectedDate]}
              conflictIds={conflictIds}
              currentUserId={currentUserId}
              dayWidth={1080}
              showDayLabels={false}
              onSelect={setSelected}
              onMove={moveIntervention}
              onEmptySlot={chooseEmptySlot}
            />
          ) : (
            <Card className="overflow-hidden">
              <CardContent className="p-3 sm:p-5">
                <FullCalendar
                  key={`${view}-${dateKey(selectedDate)}`}
                  plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                  locale={frLocale}
                  initialView={fullCalendarView}
                  initialDate={dateKey(selectedDate)}
                  headerToolbar={false}
                  firstDay={1}
                  weekends
                  allDaySlot={false}
                  nowIndicator
                  editable
                  selectable={view !== "month" && unscheduled.length > 0}
                  selectMirror
                  slotMinTime="07:00:00"
                  slotMaxTime="20:00:00"
                  slotDuration="00:30:00"
                  snapDuration="00:15:00"
                  height="auto"
                  dayMaxEvents={3}
                  events={events}
                  eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
                  slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
                  eventClick={(info: EventClickArg) => {
                    const intervention = visibleInterventions.find((item) => item.id === info.event.id);
                    if (intervention) setSelected(intervention);
                  }}
                  eventDrop={(info: EventDropArg) => persistDates(info.event.id, info.event.start, info.event.end)}
                  eventResize={(info: EventResizeDoneArg) => persistDates(info.event.id, info.event.start, info.event.end)}
                  dateClick={(info) => handleDateClick(info.date)}
                  select={(info: DateSelectArg) => chooseCalendarSlot(info.start)}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Modal open={Boolean(slot)} onClose={() => setSlot(null)} title="Planifier sur ce créneau" description={slot ? `${data.team.find((member) => member.id === slot.memberId)?.firstName ?? "Collaborateur"} · ${formatDate(slot.start.toISOString(), { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}` : undefined}>
        <div className="grid gap-4">
          {slot && teamPlanning && (
            <Field label="Collaborateur">
              <Select value={slot.memberId} className="text-zinc-900" onChange={(event) => setSlot({ ...slot, memberId: event.target.value })}>
                {planningMembers.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}
              </Select>
            </Field>
          )}
          <div className="grid gap-2">
            {unscheduled.map((item) => <button key={item.id} onClick={() => scheduleInSlot(item)} className="focus-ring surface-interactive flex items-center justify-between gap-4 rounded-xl border border-zinc-200 p-4 text-left"><span><span className="block text-sm font-bold">{item.title}</span><span className="mt-1 block text-xs text-zinc-500">{item.plannedDurationMinutes / 60} h · {item.address}</span></span><CalendarDays className="size-4 text-brand-500" /></button>)}
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title ?? "Dossier prestation"} description="Rendez-vous · réalisation · facture · paiement" className="sm:max-w-5xl">
        {selected && <InterventionDetail key={selected.id} interventionId={selected.id} />}
      </Modal>
    </div>
  );
}
