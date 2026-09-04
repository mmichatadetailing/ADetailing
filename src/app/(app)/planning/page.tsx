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
  Clock3,
  ExternalLink,
  GripVertical,
  Link2,
  LoaderCircle,
  MapPin,
  RefreshCw,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { googlePlanningConflicts, googlePlanningRange } from "@/lib/domain/google-planning";
import { startOfPlanningWeek } from "@/lib/domain/planning-timeline";
import { dateKey } from "@/lib/domain/periods";
import type { Intervention } from "@/lib/domain/types";
import { useDemoStore } from "@/lib/demo/store";
import type { GooglePlanningEvent, GooglePlanningEventsResponse } from "@/lib/integrations/google-calendar-types";
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
  const [selectedGoogleEvent, setSelectedGoogleEvent] = useState<GooglePlanningEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>("timeline");
  const [googleEvents, setGoogleEvents] = useState<GooglePlanningEvent[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const [googleSyncedAt, setGoogleSyncedAt] = useState<string | null>(null);
  const googleRequestId = useRef(0);

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
  const googleRange = useMemo(() => googlePlanningRange(selectedDate, view), [selectedDate, view]);
  const loadGoogleEvents = useCallback(async (notify = false) => {
    if (mode !== "supabase" || !workspace?.userId) {
      setGoogleEvents([]);
      setGoogleConnected(false);
      return;
    }
    const requestId = ++googleRequestId.current;
    setGoogleLoading(true);
    setGoogleError("");
    try {
      const params = new URLSearchParams(googleRange);
      const response = await fetch(`/api/integrations/google/events?${params}`, { cache: "no-store" });
      const payload = await response.json() as GooglePlanningEventsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Lecture de Google Calendar impossible.");
      if (requestId !== googleRequestId.current) return;
      setGoogleEvents(payload.events ?? []);
      setGoogleConnected(payload.connected);
      setGoogleSyncedAt(payload.syncedAt);
      setGoogleError(payload.errors?.[0] ?? "");
      if (notify) {
        if (payload.errors?.length) toast.error("Synchronisation Google incomplète", { description: payload.errors[0] });
        else toast.success("Planning Google actualisé", { description: `${payload.events.length} événement(s) trouvé(s) sur cette période.` });
      }
    } catch (cause) {
      if (requestId !== googleRequestId.current) return;
      const message = cause instanceof Error ? cause.message : "Lecture de Google Calendar impossible.";
      setGoogleError(message);
      if (notify) toast.error("Google Calendar n’a pas pu être actualisé", { description: message });
    } finally {
      if (requestId === googleRequestId.current) setGoogleLoading(false);
    }
  }, [googleRange, mode, workspace?.userId]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => { void loadGoogleEvents(); }, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadGoogleEvents();
    }, 60_000);
    const refreshOnFocus = () => { void loadGoogleEvents(); };
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void loadGoogleEvents(); };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadGoogleEvents]);
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
  const googleConflicts = useMemo(
    () => googlePlanningConflicts(scheduled, googleEvents, currentUserId),
    [currentUserId, googleEvents, scheduled],
  );
  const conflictIds = useMemo(
    () => new Set([...conflictPairs.flat(), ...googleConflicts.interventionIds]),
    [conflictPairs, googleConflicts.interventionIds],
  );

  const events = useMemo(() => [...scheduled.map((item) => {
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
      extendedProps: { source: "adetailing" },
    };
  }), ...googleEvents.map((event) => ({
    id: event.id,
    title: `Google · ${event.title}`,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    editable: false,
    startEditable: false,
    durationEditable: false,
    backgroundColor: googleConflicts.googleEventIds.has(event.id) ? "#fef2f2" : "#f0f9ff",
    borderColor: googleConflicts.googleEventIds.has(event.id) ? "#ef4444" : event.color,
    textColor: "#0c4a6e",
    classNames: event.busy ? ["google-calendar-event"] : ["google-calendar-event", "opacity-70"],
    extendedProps: { source: "google" },
  }))], [data.clients, googleConflicts.googleEventIds, googleEvents, planningMembers, scheduled]);

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
            {googleConnected && <Badge variant="blue"><CalendarDays className="mr-1 size-3" /> Google · {googleEvents.length} événement(s)</Badge>}
            {googleError && <Badge variant="red" title={googleError}><AlertTriangle className="mr-1 size-3" /> Synchronisation Google à vérifier</Badge>}
            {conflictPairs.length + googleConflicts.count > 0 && <Badge variant="red"><AlertTriangle className="mr-1 size-3" /> {conflictPairs.length + googleConflicts.count} conflit(s)</Badge>}
            <Badge variant="orange">{unscheduled.length} à planifier</Badge>
            {mode === "supabase" && (
              <Button
                size="sm"
                variant="secondary"
                className="text-zinc-700"
                disabled={googleLoading}
                title={googleSyncedAt ? `Dernière lecture : ${formatDate(googleSyncedAt, { hour: "2-digit", minute: "2-digit" })}` : "Lire les nouveaux événements Google"}
                onClick={() => void loadGoogleEvents(true)}
              >
                {googleLoading ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Actualiser Google
              </Button>
            )}
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
              googleEvents={googleEvents}
              clients={data.clients}
              days={[selectedDate]}
              conflictIds={conflictIds}
              googleConflictIds={googleConflicts.googleEventIds}
              currentUserId={currentUserId}
              dayWidth={1080}
              showDayLabels={false}
              onSelect={setSelected}
              onSelectGoogle={setSelectedGoogleEvent}
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
                  allDaySlot={googleEvents.some((event) => event.allDay)}
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
                    if (info.event.extendedProps.source === "google") {
                      const googleEvent = googleEvents.find((event) => event.id === info.event.id);
                      if (googleEvent) setSelectedGoogleEvent(googleEvent);
                      return;
                    }
                    const intervention = visibleInterventions.find((item) => item.id === info.event.id);
                    if (intervention) setSelected(intervention);
                  }}
                  eventDrop={(info: EventDropArg) => {
                    if (info.event.extendedProps.source === "google") return info.revert();
                    persistDates(info.event.id, info.event.start, info.event.end);
                  }}
                  eventResize={(info: EventResizeDoneArg) => {
                    if (info.event.extendedProps.source === "google") return info.revert();
                    persistDates(info.event.id, info.event.start, info.event.end);
                  }}
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

      <Modal
        open={Boolean(selectedGoogleEvent)}
        onClose={() => setSelectedGoogleEvent(null)}
        title={selectedGoogleEvent?.title ?? "Événement Google"}
        description={selectedGoogleEvent ? `${selectedGoogleEvent.calendarName} · ${selectedGoogleEvent.accountEmail}` : undefined}
      >
        {selectedGoogleEvent && (
          <div className="grid gap-4">
            <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 text-sm text-sky-950">
              <p className="flex items-start gap-2"><Clock3 className="mt-0.5 size-4 shrink-0 text-sky-600" /><span>{selectedGoogleEvent.allDay ? "Toute la journée" : `${formatDate(selectedGoogleEvent.start, { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })} — ${formatDate(selectedGoogleEvent.end, { hour: "2-digit", minute: "2-digit" })}`}</span></p>
              {selectedGoogleEvent.location && <p className="mt-3 flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-sky-600" /><span>{selectedGoogleEvent.location}</span></p>}
              {!selectedGoogleEvent.busy && <p className="mt-3 text-xs font-semibold text-sky-700">Cet événement est marqué comme disponible dans Google Calendar.</p>}
            </div>
            {selectedGoogleEvent.htmlLink && (
              <a
                href={selectedGoogleEvent.htmlLink}
                target="_blank"
                rel="noreferrer"
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px hover:bg-sky-700 hover:shadow-md"
              >
                <ExternalLink className="size-4" /> Ouvrir dans Google Calendar
              </a>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
