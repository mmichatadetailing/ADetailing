"use client";

import type { DateSelectArg, EventClickArg, EventDropArg } from "@fullcalendar/core";
import frLocale from "@fullcalendar/core/locales/fr";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { type EventResizeDoneArg } from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import {
  CalendarPlus2,
  Clock3,
  ExternalLink,
  GripVertical,
  MapPin,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { InterventionDetail } from "@/components/intervention-detail";
import { AppointmentForm } from "@/components/global-add";
import { PlanningSlotMenu } from "@/components/planning-slot-menu";
import { PlanningToolbar } from "@/components/planning-toolbar";
import { PlanningDatePicker } from "@/components/planning-date-picker";
import { PlanningEventEditor } from "@/components/planning-event-editor";
import { planningDragType, TeamPlanningTimeline } from "@/components/team-planning-timeline";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useWorkspace } from "@/components/workspace-provider";
import { canViewTeamPlanning, filterPlanningForUser } from "@/lib/domain/planning";
import { eventOverlapsRange, googlePlanningConflicts, googlePlanningPrefetchRange, googlePlanningRange } from "@/lib/domain/google-planning";
import { planningEventConflicts, planningEventKindLabels } from "@/lib/domain/planning-events";
import { startOfPlanningWeek } from "@/lib/domain/planning-timeline";
import { createPlanningSlot, resolvePlanningSlotMember, type PlanningSlot } from "@/lib/domain/planning-slot";
import { dateKey } from "@/lib/domain/periods";
import type { Intervention, InterventionStatus, PlanningEvent, PlanningEventKind } from "@/lib/domain/types";
import { useDemoStore } from "@/lib/demo/store";
import type { GooglePlanningEvent, GooglePlanningEventsResponse } from "@/lib/integrations/google-calendar-types";
import { cn, formatDate } from "@/lib/utils";

type CalendarView = "timeline" | "day" | "week" | "month";
type MovePayload = { interventionId: string; sourceMemberId?: string };
type PlanningSourceFilter = "all" | "adetailing" | "planning" | "google";
type PlanningStatusFilter = "all" | InterventionStatus;

const PLANNING_PREFERENCES_KEY = "adetailing-planning-preferences-v1";

const calendarViews: Array<{ id: CalendarView; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "day", label: "Jour" },
  { id: "week", label: "Semaine" },
  { id: "month", label: "Mois" },
];

const interventionStatuses: InterventionStatus[] = ["scheduled", "confirmed", "in_progress", "completed"];

function isCalendarView(value: unknown): value is CalendarView {
  return calendarViews.some((view) => view.id === value);
}

function fullCalendarViewId(view: CalendarView) {
  return view === "day" ? "timeGridDay" : view === "week" ? "timeGridWeek" : "dayGridMonth";
}

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
  const [appointmentSlot, setAppointmentSlot] = useState<PlanningSlot | null>(null);
  const [editOnOpen, setEditOnOpen] = useState(false);
  const [selected, setSelected] = useState<Intervention | null>(null);
  const [selectedGoogleEvent, setSelectedGoogleEvent] = useState<GooglePlanningEvent | null>(null);
  const [planningEventEditor, setPlanningEventEditor] = useState<{ event?: PlanningEvent; start: Date; end?: Date; allDay?: boolean; memberId?: string; kind?: PlanningEventKind } | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>("timeline");
  const [memberFilter, setMemberFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<PlanningSourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<PlanningStatusFilter>("all");
  const [googleEvents, setGoogleEvents] = useState<GooglePlanningEvent[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const [googleSyncedAt, setGoogleSyncedAt] = useState<string | null>(null);
  const googleRequestId = useRef(0);
  const calendarRef = useRef<FullCalendar | null>(null);
  const unscheduledRef = useRef<HTMLElement | null>(null);
  const calendarWasShown = useRef(false);
  const pendingCalendarScroll = useRef<string | null>(null);
  const preferencesReady = useRef(false);

  const teamPlanning = canViewTeamPlanning(workspace?.role, mode === "demo");
  const currentUserId = workspace?.userId ?? data.team[0]?.id;

  const navigatePeriod = useCallback((direction: -1 | 1) => {
    if (view === "timeline") {
      setSelectedDate((current) => addToDate(current, view, direction));
      return;
    }
    const api = calendarRef.current?.getApi();
    if (!api) {
      setSelectedDate((current) => addToDate(current, view, direction));
      return;
    }
    if (direction === -1) api.prev();
    else api.next();
    setSelectedDate(new Date(api.getDate()));
  }, [view]);

  const goToToday = useCallback(() => {
    if (view === "timeline") {
      setSelectedDate(new Date());
      return;
    }
    const api = calendarRef.current?.getApi();
    if (!api) {
      setSelectedDate(new Date());
      return;
    }
    api.today();
    setSelectedDate(new Date(api.getDate()));
  }, [view]);

  const changeCalendarView = useCallback((nextView: CalendarView) => {
    if (nextView !== "timeline") {
      const api = calendarRef.current?.getApi();
      if (api) api.changeView(fullCalendarViewId(nextView), selectedDate);
    }
    setView(nextView);
  }, [selectedDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = JSON.parse(window.localStorage.getItem(PLANNING_PREFERENCES_KEY) ?? "null") as {
          date?: string;
          view?: unknown;
          memberFilter?: string;
          sourceFilter?: PlanningSourceFilter;
          statusFilter?: PlanningStatusFilter;
        } | null;
        if (stored?.date && Number.isFinite(new Date(stored.date).getTime())) setSelectedDate(new Date(stored.date));
        if (isCalendarView(stored?.view)) setView(stored.view);
        if (stored?.memberFilter) setMemberFilter(stored.memberFilter);
        if (["all", "adetailing", "planning", "google"].includes(stored?.sourceFilter ?? "")) setSourceFilter(stored!.sourceFilter!);
        if (stored?.statusFilter === "all" || interventionStatuses.includes(stored?.statusFilter as InterventionStatus)) setStatusFilter(stored!.statusFilter!);
      } catch {
        window.localStorage.removeItem(PLANNING_PREFERENCES_KEY);
      } finally {
        preferencesReady.current = true;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!preferencesReady.current) return;
    window.localStorage.setItem(PLANNING_PREFERENCES_KEY, JSON.stringify({
      date: selectedDate.toISOString(),
      view,
      memberFilter,
      sourceFilter,
      statusFilter,
    }));
  }, [memberFilter, selectedDate, sourceFilter, statusFilter, view]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']") || document.querySelector("[role='dialog'], [aria-label='Filtres du planning'], [aria-label='Aide du planning']")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        navigatePeriod(event.key === "ArrowLeft" ? -1 : 1);
      } else if (event.key.toLowerCase() === "t") goToToday();
      else if (event.key.toLowerCase() === "j") changeCalendarView("day");
      else if (event.key.toLowerCase() === "s") changeCalendarView("week");
      else if (event.key.toLowerCase() === "m") changeCalendarView("month");
      else if (event.key.toLowerCase() === "l") changeCalendarView("timeline");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [changeCalendarView, goToToday, navigatePeriod]);
  const visibleInterventions = useMemo(
    () => filterPlanningForUser(data.interventions, { canViewTeam: teamPlanning, userId: currentUserId }),
    [currentUserId, data.interventions, teamPlanning],
  );
  const visiblePlanningEvents = useMemo(
    () => (data.planningEvents ?? []).filter((event) => teamPlanning || Boolean(currentUserId && event.memberIds.includes(currentUserId))),
    [currentUserId, data.planningEvents, teamPlanning],
  );
  const unscheduled = useMemo(
    () => visibleInterventions.filter((item) => !item.startAt && item.status === "to_schedule" && (memberFilter === "all" || item.workers.some((worker) => worker.memberId === memberFilter))),
    [memberFilter, visibleInterventions],
  );
  const scheduled = useMemo(
    () => visibleInterventions.filter((item) => item.startAt && item.endAt && item.status !== "cancelled"),
    [visibleInterventions],
  );
  const googleRange = useMemo(() => googlePlanningRange(selectedDate, view), [selectedDate, view]);
  const googleFetchRange = useMemo(() => googlePlanningPrefetchRange(selectedDate, view), [selectedDate, view]);
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
      const params = new URLSearchParams(googleFetchRange);
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
  }, [googleFetchRange, mode, workspace?.userId]);

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
    const assignedMemberIds = new Set([
      ...visibleInterventions.flatMap((item) => item.workers.map((worker) => worker.memberId)),
      ...visiblePlanningEvents.flatMap((event) => event.memberIds),
    ]);
    return data.team.filter((member) =>
      (teamPlanning || member.id === currentUserId) && (member.active || assignedMemberIds.has(member.id)),
    );
  }, [currentUserId, data.team, teamPlanning, visibleInterventions, visiblePlanningEvents]);
  const filteredMembers = useMemo(
    () => planningMembers.filter((member) => memberFilter === "all" || member.id === memberFilter),
    [memberFilter, planningMembers],
  );
  const filteredScheduled = useMemo(
    () => scheduled.filter((intervention) =>
      (sourceFilter === "all" || sourceFilter === "adetailing")
      && (statusFilter === "all" || intervention.status === statusFilter)
      && (memberFilter === "all" || intervention.workers.some((worker) => worker.memberId === memberFilter)),
    ),
    [memberFilter, scheduled, sourceFilter, statusFilter],
  );
  const filteredPlanningEvents = useMemo(
    () => visiblePlanningEvents.filter((event) =>
      (sourceFilter === "all" || sourceFilter === "planning")
      && (memberFilter === "all" || event.memberIds.includes(memberFilter)),
    ),
    [memberFilter, sourceFilter, visiblePlanningEvents],
  );
  const filteredGoogleEvents = useMemo(
    () => googleEvents.filter((event) =>
      (sourceFilter === "all" || sourceFilter === "google")
      && (memberFilter === "all" || event.memberId === memberFilter),
    ),
    [googleEvents, memberFilter, sourceFilter],
  );
  const visibleGoogleEvents = useMemo(
    () => googleEvents.filter((event) => eventOverlapsRange(event.start, event.end, googleRange)),
    [googleEvents, googleRange],
  );

  const conflictScheduled = useMemo(
    () => scheduled.filter((item) => item.startAt && item.endAt && eventOverlapsRange(item.startAt, item.endAt, googleRange)),
    [googleRange, scheduled],
  );
  const conflictPlanningEvents = useMemo(
    () => visiblePlanningEvents.filter((event) => eventOverlapsRange(event.startAt, event.endAt, googleRange)),
    [googleRange, visiblePlanningEvents],
  );
  const conflictPairs = useMemo(() => conflictScheduled.flatMap((item, index) => conflictScheduled.slice(index + 1).filter((other) => {
    if (!item.startAt || !item.endAt || !other.startAt || !other.endAt) return false;
    const sameWorker = item.workers.some((worker) => other.workers.some((entry) => entry.memberId === worker.memberId));
    return sameWorker && new Date(item.startAt) < new Date(other.endAt) && new Date(other.startAt) < new Date(item.endAt);
  }).map((other) => [item.id, other.id] as const)), [conflictScheduled]);
  const googleConflicts = useMemo(
    () => googlePlanningConflicts(conflictScheduled, visibleGoogleEvents, currentUserId),
    [conflictScheduled, currentUserId, visibleGoogleEvents],
  );
  const internalPlanningConflicts = useMemo(
    () => planningEventConflicts(conflictScheduled, conflictPlanningEvents, visibleGoogleEvents),
    [conflictPlanningEvents, conflictScheduled, visibleGoogleEvents],
  );
  const conflictIds = useMemo(
    () => new Set([...conflictPairs.flat(), ...googleConflicts.interventionIds, ...internalPlanningConflicts.interventionIds]),
    [conflictPairs, googleConflicts.interventionIds, internalPlanningConflicts.interventionIds],
  );
  const googleConflictIds = useMemo(
    () => new Set([...googleConflicts.googleEventIds, ...internalPlanningConflicts.googleEventIds]),
    [googleConflicts.googleEventIds, internalPlanningConflicts.googleEventIds],
  );
  const conflictCount = conflictPairs.length + googleConflicts.count + internalPlanningConflicts.count;

  const events = useMemo(() => [...filteredScheduled.map((item) => {
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
  }), ...filteredPlanningEvents.map((event) => ({
    id: event.id,
    title: `${planningEventKindLabels[event.kind]} · ${event.title}`,
    start: event.startAt,
    end: event.endAt,
    allDay: event.allDay,
    editable: teamPlanning || (event.memberIds.length === 1 && event.memberIds[0] === currentUserId),
    backgroundColor: internalPlanningConflicts.planningEventIds.has(event.id) ? "#fef2f2" : `${event.color ?? "#8b5cf6"}1c`,
    borderColor: internalPlanningConflicts.planningEventIds.has(event.id) ? "#ef4444" : event.color ?? "#8b5cf6",
    textColor: "#27223a",
    extendedProps: { source: "planning" },
  })), ...filteredGoogleEvents.map((event) => ({
    id: event.id,
    title: `Google · ${event.title}`,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    editable: false,
    startEditable: false,
    durationEditable: false,
    backgroundColor: googleConflictIds.has(event.id) ? "#fef2f2" : "#f0f9ff",
    borderColor: googleConflictIds.has(event.id) ? "#ef4444" : event.color,
    textColor: "#0c4a6e",
    classNames: event.busy ? ["google-calendar-event"] : ["google-calendar-event", "opacity-70"],
    extendedProps: { source: "google" },
  }))], [currentUserId, data.clients, filteredGoogleEvents, filteredPlanningEvents, filteredScheduled, googleConflictIds, internalPlanningConflicts.planningEventIds, planningMembers, teamPlanning]);

  const moveIntervention = (payload: MovePayload, targetMemberId: string, start: Date, durationMinutes?: number) => {
    const intervention = visibleInterventions.find((item) => item.id === payload.interventionId);
    if (!intervention) return toast.error("Cette prestation n’est plus disponible dans le planning.");
    const workers = reassignWorkers(intervention, teamPlanning ? payload.sourceMemberId : undefined, targetMemberId);
    data.updateIntervention(intervention.id, {
      clientId: intervention.clientId,
      vehicleId: intervention.vehicleId,
      vehicleFormat: intervention.vehicleFormat,
      title: intervention.title,
      status: intervention.status === "to_schedule" ? "scheduled" : intervention.status,
      startAt: start.toISOString(),
      plannedDurationMinutes: durationMinutes ?? intervention.plannedDurationMinutes,
      address: intervention.address,
      notes: intervention.notes,
      workers: workers.map((worker) => ({ memberId: worker.memberId, plannedMinutes: worker.memberId === targetMemberId ? durationMinutes ?? worker.plannedMinutes : worker.plannedMinutes })),
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

  const persistPlanningEventDates = (eventId: string, start: Date | null, end: Date | null, allDay: boolean) => {
    const planningEvent = visiblePlanningEvents.find((event) => event.id === eventId);
    if (!planningEvent || !start) return;
    const computedEnd = end ?? new Date(start.getTime() + Math.max(15 * 60_000, new Date(planningEvent.endAt).getTime() - new Date(planningEvent.startAt).getTime()));
    data.updatePlanningEvent(eventId, { ...planningEvent, startAt: start.toISOString(), endAt: computedEnd.toISOString(), allDay });
    toast.success("Événement déplacé", { description: formatDate(start.toISOString(), { weekday: "long", hour: "2-digit", minute: "2-digit" }) });
  };

  const openNewSlot = () => {
    const start = new Date(selectedDate);
    const now = new Date();
    if (dateKey(start) === dateKey(now)) {
      start.setHours(now.getHours() + 1, 0, 0, 0);
    } else {
      start.setHours(9, 0, 0, 0);
    }
    chooseCalendarSlot(start);
  };

  const jumpToFirstConflict = () => {
    const candidates = [
      ...conflictScheduled.filter((event) => conflictIds.has(event.id)).map((event) => ({ start: event.startAt!, memberId: event.workers[0]?.memberId })),
      ...conflictPlanningEvents.filter((event) => internalPlanningConflicts.planningEventIds.has(event.id)).map((event) => ({ start: event.startAt, memberId: event.memberIds[0] })),
      ...visibleGoogleEvents.filter((event) => googleConflictIds.has(event.id)).map((event) => ({ start: event.start, memberId: event.memberId })),
    ].sort((left, right) => left.start.localeCompare(right.start));
    const first = candidates[0];
    if (!first) return;
    const conflictDate = new Date(first.start);
    if (!teamPlanning) {
      const minutes = Math.max(7 * 60, conflictDate.getHours() * 60 + conflictDate.getMinutes() - 45);
      pendingCalendarScroll.current = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;
    }
    setSelectedDate(conflictDate);
    if (teamPlanning) setView("timeline");
    else setView("day");
    if (first.memberId && planningMembers.some((member) => member.id === first.memberId)) setMemberFilter(first.memberId);
  };

  const chooseEmptySlot = (memberId: string, start: Date, end?: Date) => {
    if (!planningMembers.some((member) => member.id === memberId && member.active)) return toast.error("Ce collaborateur est inactif. Choisissez une ligne active.");
    setSlot(createPlanningSlot(start, memberId, end));
  };

  const chooseCalendarSlot = (start: Date, end?: Date, allDay = false) => {
    const memberId = resolvePlanningSlotMember(planningMembers, memberFilter, currentUserId);
    if (memberId) setSlot(createPlanningSlot(start, memberId, end, allDay));
    else toast.error("Ajoutez un collaborateur actif avant de planifier un événement.");
  };

  const closeSlot = () => {
    setSlot(null);
    calendarRef.current?.getApi().unselect();
  };

  const scheduleInSlot = (intervention: Intervention, start: Date, durationMinutes: number) => {
    if (!slot) return;
    moveIntervention({ interventionId: intervention.id }, slot.memberId, start, durationMinutes);
    setSourceFilter("all");
    setStatusFilter("all");
    if (memberFilter !== "all") setMemberFilter(slot.memberId);
    closeSlot();
  };

  const createFromSlot = (kind: "appointment" | PlanningEventKind) => {
    if (!slot) return;
    if (kind === "appointment") setAppointmentSlot(slot);
    else setPlanningEventEditor({ start: slot.start, end: slot.end, allDay: slot.allDay, memberId: slot.memberId, kind });
    closeSlot();
  };

  const openIntervention = (intervention: Intervention) => {
    setEditOnOpen(false);
    setSelected(intervention);
  };

  const openCreatedIntervention = (id: string) => {
    const intervention = useDemoStore.getState().interventions.find((item) => item.id === id);
    if (intervention) {
      setEditOnOpen(true);
      setSelected(intervention);
      if (memberFilter !== "all" && !intervention.workers.some((worker) => worker.memberId === memberFilter)) setMemberFilter(intervention.workers[0]?.memberId ?? "all");
    }
    setSourceFilter("all");
    setStatusFilter("all");
  };

  const fullCalendarView = fullCalendarViewId(view);
  const showUnscheduled = unscheduled.length > 0 && (sourceFilter === "all" || sourceFilter === "adetailing");
  const preferredScrollTime = useMemo(() => {
    const selectedKey = dateKey(selectedDate);
    const starts = [
      ...filteredScheduled.map((item) => item.startAt),
      ...filteredPlanningEvents.filter((event) => !event.allDay).map((event) => event.startAt),
      ...filteredGoogleEvents.filter((event) => !event.allDay).map((event) => event.start),
    ]
      .filter((start): start is string => Boolean(start) && dateKey(new Date(start!)) === selectedKey)
      .map((start) => new Date(start));
    const now = new Date();
    const first = starts.sort((left, right) => left.getTime() - right.getTime())[0];
    const reference = selectedKey === dateKey(now) ? now : first;
    const minutes = reference ? reference.getHours() * 60 + reference.getMinutes() - 60 : 8 * 60;
    const clamped = Math.max(7 * 60, Math.min(19 * 60, minutes));
    return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}:00`;
  }, [filteredGoogleEvents, filteredPlanningEvents, filteredScheduled, selectedDate]);

  useEffect(() => {
    if (view === "timeline") return;
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (api.view.type !== fullCalendarView) api.changeView(fullCalendarView, selectedDate);
    else api.gotoDate(selectedDate);
    const scrollTarget = pendingCalendarScroll.current ?? (!calendarWasShown.current ? preferredScrollTime : null);
    pendingCalendarScroll.current = null;
    calendarWasShown.current = true;
    const frame = window.requestAnimationFrame(() => {
      api.updateSize();
      if (scrollTarget) api.scrollToTime(scrollTarget);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fullCalendarView, preferredScrollTime, selectedDate, showUnscheduled, view]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-extrabold tracking-tight text-slate-900">{teamPlanning ? "Planning de l’équipe" : "Mon planning"}</h1>
      <PlanningToolbar
        title={viewTitle(selectedDate, view)}
        view={view}
        onNavigate={navigatePeriod}
        onToday={goToToday}
        onChooseDate={() => setDatePickerOpen(true)}
        onChangeView={changeCalendarView}
        onAdd={openNewSlot}
        teamPlanning={teamPlanning}
        members={planningMembers}
        memberFilter={memberFilter}
        sourceFilter={sourceFilter}
        statusFilter={statusFilter}
        onMemberChange={setMemberFilter}
        onSourceChange={(source) => {
          setSourceFilter(source);
          if (source === "google" || source === "planning") setStatusFilter("all");
        }}
        onStatusChange={setStatusFilter}
        onResetFilters={() => { setMemberFilter("all"); setSourceFilter("all"); setStatusFilter("all"); }}
        googleEnabled={mode === "supabase"}
        googleConnected={googleConnected}
        googleLoading={googleLoading}
        googleError={googleError}
        googleCount={visibleGoogleEvents.length}
        googleSyncedAt={googleSyncedAt}
        onSync={() => void loadGoogleEvents(true)}
        conflictCount={conflictCount}
        onConflict={jumpToFirstConflict}
        unscheduledCount={showUnscheduled ? unscheduled.length : 0}
        onUnscheduled={() => {
          unscheduledRef.current?.scrollIntoView({ block: "start" });
          unscheduledRef.current?.focus({ preventScroll: true });
        }}
      />

      <div className={cn("grid gap-5", showUnscheduled ? "xl:grid-cols-[250px_minmax(0,1fr)]" : "grid-cols-1")}>
        {showUnscheduled && <aside ref={unscheduledRef} tabIndex={-1} aria-label="Prestations à planifier" className="scroll-mt-[calc(var(--app-header-height)+170px)] rounded-2xl">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2"><CalendarPlus2 className="size-4 text-brand-500" /><h2 className="text-sm font-bold">{teamPlanning ? "Non planifiées" : "À planifier pour moi"}</h2></div>
              <div className="mt-4 grid gap-2">
                {unscheduled.map((item) => {
                  const client = data.clients.find((entry) => entry.id === item.clientId);
                  const vehicle = data.vehicles.find((entry) => entry.id === item.vehicleId);
                  return (
                    <button
                      key={item.id}
                      draggable={view === "timeline"}
                      type="button"
                      onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(planningDragType, JSON.stringify({ interventionId: item.id } satisfies MovePayload)); }}
                      onClick={() => openIntervention(item)}
                      className={cn("focus-ring surface-interactive rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-sm", view === "timeline" && "cursor-grab active:cursor-grabbing")}
                    >
                      <div className="flex items-start gap-2"><GripVertical className="mt-0.5 size-3.5 text-zinc-400" /><div className="min-w-0"><p className="truncate text-xs font-bold text-zinc-900">{client?.company || `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim()}</p><p className="mt-1 truncate text-[11px] text-zinc-500">{vehicle ? `${vehicle.make} ${vehicle.model}` : item.vehicleFormat || "Véhicule non renseigné"}</p><p className="mt-2 text-[10px] font-bold text-brand-600">{item.plannedDurationMinutes / 60} h · {item.workers.length || 1} pers.</p></div></div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </aside>}

        <div className="relative z-0 min-w-0">
          {view === "timeline" && (
            <TeamPlanningTimeline
              members={filteredMembers}
              interventions={filteredScheduled}
              planningEvents={filteredPlanningEvents}
              googleEvents={filteredGoogleEvents}
              clients={data.clients}
              days={[selectedDate]}
              conflictIds={conflictIds}
              googleConflictIds={googleConflictIds}
              planningConflictIds={internalPlanningConflicts.planningEventIds}
              currentUserId={currentUserId}
              dayWidth={1080}
              showDayLabels={false}
              onSelect={openIntervention}
              onSelectGoogle={setSelectedGoogleEvent}
              onSelectPlanningEvent={(event) => setPlanningEventEditor({ event, start: new Date(event.startAt) })}
              onMove={moveIntervention}
              onEmptySlot={chooseEmptySlot}
            />
          )}
          <div className={cn(view === "timeline" && "hidden")} aria-hidden={view === "timeline"}>
            <Card className="overflow-hidden">
              <CardContent className="p-3 sm:p-5">
                <FullCalendar
                  ref={calendarRef}
                  plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                  locale={frLocale}
                  initialView={fullCalendarView}
                  initialDate={dateKey(selectedDate)}
                  headerToolbar={false}
                  firstDay={1}
                  weekends
                  allDaySlot
                  nowIndicator
                  editable
                  eventStartEditable
                  eventDurationEditable
                  selectable
                  selectMinDistance={5}
                  selectLongPressDelay={350}
                  selectMirror
                  slotMinTime="07:00:00"
                  slotMaxTime="20:00:00"
                  slotDuration="00:30:00"
                  snapDuration="00:15:00"
                  scrollTime={preferredScrollTime}
                  scrollTimeReset={false}
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
                    if (info.event.extendedProps.source === "planning") {
                      const planningEvent = visiblePlanningEvents.find((event) => event.id === info.event.id);
                      if (planningEvent) setPlanningEventEditor({ event: planningEvent, start: new Date(planningEvent.startAt) });
                      return;
                    }
                    const intervention = visibleInterventions.find((item) => item.id === info.event.id);
                    if (intervention) openIntervention(intervention);
                  }}
                  eventDrop={(info: EventDropArg) => {
                    if (info.event.extendedProps.source === "google") return info.revert();
                    if (info.event.extendedProps.source === "planning") {
                      persistPlanningEventDates(info.event.id, info.event.start, info.event.end, info.event.allDay);
                      return;
                    }
                    persistDates(info.event.id, info.event.start, info.event.end);
                  }}
                  eventResize={(info: EventResizeDoneArg) => {
                    if (info.event.extendedProps.source === "google") return info.revert();
                    if (info.event.extendedProps.source === "planning") {
                      persistPlanningEventDates(info.event.id, info.event.start, info.event.end, info.event.allDay);
                      return;
                    }
                    persistDates(info.event.id, info.event.start, info.event.end);
                  }}
                  dateClick={(info) => chooseCalendarSlot(info.date, undefined, info.allDay)}
                  select={(info: DateSelectArg) => chooseCalendarSlot(info.start, info.end, info.allDay)}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {datePickerOpen && (
        <PlanningDatePicker
          selectedDate={selectedDate}
          onSelect={setSelectedDate}
          onClose={() => setDatePickerOpen(false)}
        />
      )}

      {planningEventEditor && currentUserId && (
        <PlanningEventEditor
          key={planningEventEditor.event?.id ?? planningEventEditor.start.toISOString()}
          event={planningEventEditor.event}
          initialStart={planningEventEditor.start}
          initialEnd={planningEventEditor.end}
          initialAllDay={planningEventEditor.allDay}
          initialMemberId={planningEventEditor.memberId}
          initialKind={planningEventEditor.kind}
          currentUserId={currentUserId}
          members={planningMembers}
          canAssignTeam={teamPlanning}
          canEdit={!planningEventEditor.event || teamPlanning || (planningEventEditor.event.memberIds.length === 1 && planningEventEditor.event.memberIds[0] === currentUserId)}
          onSaved={() => { if (!planningEventEditor.event) { setSourceFilter("all"); setMemberFilter("all"); } }}
          onClose={() => setPlanningEventEditor(null)}
        />
      )}

      {slot && <PlanningSlotMenu key={`${slot.start.toISOString()}-${slot.end.toISOString()}`} slot={slot} members={planningMembers} canAssignTeam={teamPlanning} unscheduled={unscheduled} clients={data.clients} onChange={setSlot} onCreate={createFromSlot} onSchedule={scheduleInSlot} onClose={closeSlot} />}

      <Modal open={Boolean(appointmentSlot)} onClose={() => setAppointmentSlot(null)} title="Nouvelle prestation" description="Le créneau du planning est repris. Tout reste modifiable.">
        {appointmentSlot && <AppointmentForm initialSlot={appointmentSlot} allowedMemberIds={planningMembers.map((member) => member.id)} close={() => setAppointmentSlot(null)} onCreated={openCreatedIntervention} />}
      </Modal>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title ?? "Dossier prestation"} description="Rendez-vous · réalisation · facture · paiement" className="sm:max-w-5xl">
        {selected && <InterventionDetail key={`${selected.id}-${editOnOpen}`} interventionId={selected.id} startEditing={editOnOpen} />}
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
