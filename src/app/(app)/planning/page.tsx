"use client";

import type { DateSelectArg, EventClickArg, EventDropArg } from "@fullcalendar/core";
import frLocale from "@fullcalendar/core/locales/fr";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { type EventResizeDoneArg } from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import {
  AlertTriangle,
  CalendarClock,
  Clock3,
  ExternalLink,
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
import { PlanningMoveDialog } from "@/components/planning-move-dialog";
import { PlanningSidePanel } from "@/components/planning-side-panel";
import { PlanningUnscheduledTray } from "@/components/planning-unscheduled-tray";
import { TeamPlanningTimeline } from "@/components/team-planning-timeline";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace-provider";
import { canViewTeamPlanning, filterPlanningForUser } from "@/lib/domain/planning";
import { eventOverlapsRange, googlePlanningConflicts, googlePlanningPrefetchRange, googlePlanningRange } from "@/lib/domain/google-planning";
import { planningEventConflicts, planningEventKindLabels, planningMoveConflicts, type PlanningMoveConflict } from "@/lib/domain/planning-events";
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
type MoveEditor = { source: "intervention" | "planning"; id: string };
type PendingCalendarMove = {
  label: string;
  start: Date;
  conflicts: PlanningMoveConflict[];
  apply: () => void;
  cancel?: () => void;
};

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

function reassignMemberIds(memberIds: string[], sourceMemberId: string | undefined, targetMemberId: string) {
  if (!sourceMemberId || sourceMemberId === targetMemberId || memberIds.includes(targetMemberId)) return memberIds;
  return memberIds.map((memberId) => memberId === sourceMemberId ? targetMemberId : memberId);
}

function editableIntervention(intervention: Intervention) {
  return {
    clientId: intervention.clientId,
    vehicleId: intervention.vehicleId,
    vehicleFormat: intervention.vehicleFormat,
    title: intervention.title,
    status: intervention.status,
    startAt: intervention.startAt,
    plannedDurationMinutes: intervention.plannedDurationMinutes,
    address: intervention.address,
    notes: intervention.notes,
    workers: intervention.workers.map((worker) => ({ memberId: worker.memberId, plannedMinutes: worker.plannedMinutes })),
    items: intervention.items.map((item) => ({ id: item.id, serviceId: item.serviceId, label: item.label, quantity: item.quantity, revenueAllocated: item.revenueAllocated })),
  };
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
  const [moveEditor, setMoveEditor] = useState<MoveEditor | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingCalendarMove | null>(null);
  const [panelDirty, setPanelDirty] = useState(false);
  const [panelBusy, setPanelBusy] = useState(false);
  const [panelRevision, setPanelRevision] = useState(0);
  const [pendingPanelAction, setPendingPanelAction] = useState<(() => void) | null>(null);
  const panelTrigger = useRef<HTMLElement | null>(null);
  const calendarContainer = useRef<HTMLDivElement | null>(null);
  const panelOpen = Boolean(selected || selectedGoogleEvent || planningEventEditor || appointmentSlot);
  const calendarInteractionLocked = panelOpen || Boolean(pendingMove);

  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>("timeline");
  const [memberFilter, setMemberFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<PlanningSourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<PlanningStatusFilter>("all");
  const [unscheduledExpanded, setUnscheduledExpanded] = useState(false);
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
  const pendingUnscheduledFocus = useRef(false);

  const clearPanel = () => {
    setSelected(null);
    setSelectedGoogleEvent(null);
    setPlanningEventEditor(null);
    setAppointmentSlot(null);
    setMoveEditor(null);
    setPanelDirty(false);
    setPanelBusy(false);
  };
  const attemptPanelAction = (action: () => void) => {
    if (panelBusy) return toast.info("Veuillez attendre la fin de l’enregistrement.");
    if (panelDirty) setPendingPanelAction(() => action);
    else action();
  };
  const replacePanel = (open: () => void) => attemptPanelAction(() => {
    if (!panelOpen && document.activeElement instanceof HTMLElement) panelTrigger.current = document.activeElement;
    clearPanel();
    setPanelRevision((revision) => revision + 1);
    open();
  });
  const closePanel = () => attemptPanelAction(() => {
    clearPanel();
    requestAnimationFrame(() => {
      const target = panelTrigger.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
      else calendarContainer.current?.focus({ preventScroll: true });
    });
  });

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
          unscheduledExpanded?: boolean;
        } | null;
        if (stored?.date && Number.isFinite(new Date(stored.date).getTime())) setSelectedDate(new Date(stored.date));
        if (isCalendarView(stored?.view)) setView(stored.view);
        if (stored?.memberFilter) setMemberFilter(stored.memberFilter);
        if (["all", "adetailing", "planning", "google"].includes(stored?.sourceFilter ?? "")) setSourceFilter(stored!.sourceFilter!);
        if (stored?.statusFilter === "all" || interventionStatuses.includes(stored?.statusFilter as InterventionStatus)) setStatusFilter(stored!.statusFilter!);
        if (typeof stored?.unscheduledExpanded === "boolean") setUnscheduledExpanded(stored.unscheduledExpanded);
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
      unscheduledExpanded,
    }));
  }, [memberFilter, selectedDate, sourceFilter, statusFilter, unscheduledExpanded, view]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-planning-panel]") || target?.matches("input, textarea, select, [contenteditable='true']") || document.querySelector("[role='dialog'], [aria-label='Filtres du planning'], [aria-label='Aide du planning']")) return;
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
    editable: !calendarInteractionLocked && (teamPlanning || (event.memberIds.length === 1 && event.memberIds[0] === currentUserId)),
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
  }))], [calendarInteractionLocked, currentUserId, data.clients, filteredGoogleEvents, filteredPlanningEvents, filteredScheduled, googleConflictIds, internalPlanningConflicts.planningEventIds, planningMembers, teamPlanning]);

  const showMoveToast = (key: string, label: string, start: Date, undo: () => void) => {
    const toastId = `planning-move:${key}`;
    toast.success(`${label} déplacé${label.endsWith("e") ? "e" : ""}`, {
      id: toastId,
      description: formatDate(start.toISOString(), { weekday: "long", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
      duration: 8_000,
      action: {
        label: "Annuler",
        onClick: () => {
          undo();
          toast.success("Déplacement annulé", { duration: 2_500 });
        },
      },
    });
  };

  const runOrConfirmMove = (request: PendingCalendarMove) => {
    if (request.conflicts.length === 0) request.apply();
    else setPendingMove(request);
  };

  const requestInterventionMove = ({
    payload,
    targetMemberId,
    start,
    end,
    durationMinutes,
    cancel,
  }: {
    payload: MovePayload;
    targetMemberId: string;
    start: Date;
    end?: Date | null;
    durationMinutes?: number;
    cancel?: () => void;
  }) => {
    const intervention = visibleInterventions.find((item) => item.id === payload.interventionId);
    if (!intervention) return toast.error("Cette prestation n’est plus disponible dans le planning.");
    const workers = reassignWorkers(intervention, teamPlanning ? payload.sourceMemberId : undefined, targetMemberId);
    const resolvedDuration = durationMinutes ?? (end ? Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000)) : intervention.plannedDurationMinutes);
    const nextInput = {
      ...editableIntervention(intervention),
      status: intervention.status === "to_schedule" ? "scheduled" as const : intervention.status,
      startAt: start.toISOString(),
      plannedDurationMinutes: resolvedDuration,
      workers: workers.map((worker) => ({ memberId: worker.memberId, plannedMinutes: worker.memberId === targetMemberId ? resolvedDuration : worker.plannedMinutes })),
    };
    const previousInput = editableIntervention(intervention);
    const computedEnd = new Date(start.getTime() + resolvedDuration * 60_000);
    const assignmentChanged = workers.length !== intervention.workers.length || workers.some((worker, index) => worker.memberId !== intervention.workers[index]?.memberId);
    const canUseLightweightMove = Boolean(intervention.startAt && intervention.endAt) && !assignmentChanged && resolvedDuration === intervention.plannedDurationMinutes;
    const conflicts = planningMoveConflicts({
      id: intervention.id,
      source: "intervention",
      title: intervention.title,
      startAt: start.toISOString(),
      endAt: computedEnd.toISOString(),
      memberIds: workers.map((worker) => worker.memberId),
    }, visibleInterventions, visiblePlanningEvents, googleEvents);
    runOrConfirmMove({
      label: "Rendez-vous",
      start,
      conflicts,
      cancel,
      apply: () => {
        if (canUseLightweightMove) data.rescheduleIntervention(intervention.id, nextInput.startAt, computedEnd.toISOString());
        else data.updateIntervention(intervention.id, nextInput);
        showMoveToast(`intervention:${intervention.id}`, "Rendez-vous", start, () => {
          if (canUseLightweightMove && intervention.startAt && intervention.endAt) data.rescheduleIntervention(intervention.id, intervention.startAt, intervention.endAt);
          else data.updateIntervention(intervention.id, previousInput);
        });
      },
    });
  };

  const moveIntervention = (payload: MovePayload, targetMemberId: string, start: Date, durationMinutes?: number) => {
    requestInterventionMove({ payload, targetMemberId, start, durationMinutes });
  };

  const persistDates = (interventionId: string, start: Date | null, end: Date | null, cancel?: () => void) => {
    const intervention = visibleInterventions.find((item) => item.id === interventionId);
    if (!intervention || !start) return;
    const targetMemberId = intervention.workers[0]?.memberId;
    if (!targetMemberId) return cancel?.();
    requestInterventionMove({ payload: { interventionId }, targetMemberId, start, end, cancel });
  };

  const persistPlanningEventDates = (eventId: string, start: Date | null, end: Date | null, allDay: boolean, memberIds?: string[], cancel?: () => void) => {
    const planningEvent = visiblePlanningEvents.find((event) => event.id === eventId);
    if (!planningEvent || !start) return;
    const computedEnd = end ?? new Date(start.getTime() + Math.max(15 * 60_000, new Date(planningEvent.endAt).getTime() - new Date(planningEvent.startAt).getTime()));
    const nextMemberIds = memberIds ?? planningEvent.memberIds;
    const nextInput = { ...planningEvent, startAt: start.toISOString(), endAt: computedEnd.toISOString(), allDay, memberIds: nextMemberIds };
    const previousInput = { ...planningEvent };
    const conflicts = planningMoveConflicts({
      id: planningEvent.id,
      source: "planning",
      title: planningEvent.title,
      startAt: nextInput.startAt,
      endAt: nextInput.endAt,
      memberIds: nextMemberIds,
    }, visibleInterventions, visiblePlanningEvents, googleEvents);
    runOrConfirmMove({
      label: "Événement",
      start,
      conflicts,
      cancel,
      apply: () => {
        data.updatePlanningEvent(eventId, nextInput);
        showMoveToast(`planning:${eventId}`, "Événement", start, () => data.updatePlanningEvent(eventId, previousInput));
      },
    });
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
    closeSlot();
    replacePanel(() => {
      if (kind === "appointment") setAppointmentSlot(slot);
      else setPlanningEventEditor({ start: slot.start, end: slot.end, allDay: slot.allDay, memberId: slot.memberId, kind });
    });
  };

  const openIntervention = (intervention: Intervention) => {
    if (selected?.id === intervention.id) return;
    replacePanel(() => { setEditOnOpen(false); setSelected(intervention); });
  };
  const openPlanningEvent = (event: PlanningEvent) => {
    if (planningEventEditor?.event?.id === event.id) return;
    replacePanel(() => setPlanningEventEditor({ event, start: new Date(event.startAt) }));
  };
  const openGoogleEvent = (event: GooglePlanningEvent) => {
    if (selectedGoogleEvent?.id === event.id) return;
    replacePanel(() => setSelectedGoogleEvent(event));
  };

  const openCreatedIntervention = (id: string) => {
    clearPanel();
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
  const panelItems = [
    ...filteredScheduled.map((item) => ({ key: `intervention:${item.id}`, start: item.startAt!, end: item.endAt!, open: () => openIntervention(item) })),
    ...filteredPlanningEvents.map((item) => ({ key: `planning:${item.id}`, start: item.startAt, end: item.endAt, open: () => openPlanningEvent(item) })),
    ...filteredGoogleEvents.map((item) => ({ key: `google:${item.id}`, start: item.start, end: item.end, open: () => openGoogleEvent(item) })),
  ].filter((item) => eventOverlapsRange(item.start, item.end, googleRange))
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime() || left.key.localeCompare(right.key));
  const panelKey = selected ? `intervention:${selected.id}` : selectedGoogleEvent ? `google:${selectedGoogleEvent.id}` : planningEventEditor?.event ? `planning:${planningEventEditor.event.id}` : appointmentSlot ? "new-appointment" : "new-event";
  const panelIndex = panelItems.findIndex((item) => item.key === panelKey);
  const currentIntervention = data.interventions.find((item) => item.id === selected?.id);
  const currentPlanningEvent = data.planningEvents?.find((item) => item.id === planningEventEditor?.event?.id);
  const movableIntervention = moveEditor?.source === "intervention" ? data.interventions.find((item) => item.id === moveEditor.id) : undefined;
  const movablePlanningEvent = moveEditor?.source === "planning" ? data.planningEvents?.find((item) => item.id === moveEditor.id) : undefined;
  const canMovePlanningEvent = Boolean(currentPlanningEvent && (teamPlanning || (currentPlanningEvent.memberIds.length === 1 && currentPlanningEvent.memberIds[0] === currentUserId)));
  const panelTitle = selected ? currentIntervention?.title ?? "Dossier prestation" : selectedGoogleEvent?.title ?? (planningEventEditor ? currentPlanningEvent?.title ?? "Nouvel événement" : "Nouvelle prestation");
  const panelDescription = selected ? "Rendez-vous · réalisation · facture · paiement" : selectedGoogleEvent ? `${selectedGoogleEvent.calendarName} · ${selectedGoogleEvent.accountEmail}` : planningEventEditor ? "Réunion, absence ou bloc horaire sans créer de prestation." : "Le créneau sélectionné est repris. Tout reste modifiable.";
  const showUnscheduled = unscheduled.length > 0 && (sourceFilter === "all" || sourceFilter === "adetailing");
  const revealUnscheduled = () => {
    pendingUnscheduledFocus.current = true;
    setSourceFilter("all");
    setStatusFilter("all");
    setUnscheduledExpanded(true);
  };
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

  useEffect(() => {
    if (!showUnscheduled || !unscheduledExpanded || !pendingUnscheduledFocus.current) return;
    pendingUnscheduledFocus.current = false;
    const frame = requestAnimationFrame(() => {
      unscheduledRef.current?.scrollIntoView({ block: "nearest" });
      unscheduledRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [showUnscheduled, unscheduledExpanded]);

  useEffect(() => {
    const container = calendarContainer.current;
    if (!container) return;
    let frame = 0;
    let previousWidth = -1;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === previousWidth) return;
      previousWidth = entry.contentRect.width;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => calendarRef.current?.getApi().updateSize());
    });
    observer.observe(container);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  return (
    <div className="planning-workspace space-y-4" data-panel-open={panelOpen}>
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
        unscheduledCount={unscheduled.length}
        unscheduledExpanded={showUnscheduled && unscheduledExpanded}
        onUnscheduled={revealUnscheduled}
      />

      <div className="grid gap-4">
        {showUnscheduled && <PlanningUnscheduledTray ref={unscheduledRef} interventions={unscheduled} clients={data.clients} vehicles={data.vehicles} members={data.team} expanded={unscheduledExpanded} canDrag={view === "timeline" && !calendarInteractionLocked} teamPlanning={teamPlanning} onToggle={() => setUnscheduledExpanded((expanded) => !expanded)} onOpen={openIntervention} />}

        <div ref={calendarContainer} tabIndex={-1} aria-label="Calendrier" className="relative z-0 min-w-0">
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
              onSelectGoogle={openGoogleEvent}
              onSelectPlanningEvent={openPlanningEvent}
              onMove={moveIntervention}
              canDrag={!calendarInteractionLocked}
              activeEventKey={panelOpen ? panelKey : undefined}
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
                  editable={!calendarInteractionLocked}
                  eventStartEditable={!calendarInteractionLocked}
                  eventDurationEditable={!calendarInteractionLocked}
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
                  eventClassNames={(info) => {
                    const source = info.event.extendedProps.source === "adetailing" ? "intervention" : info.event.extendedProps.source;
                    return panelOpen && panelKey === `${source}:${info.event.id}` ? ["planning-current-event"] : [];
                  }}
                  eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
                  slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
                  eventClick={(info: EventClickArg) => {
                    if (info.event.extendedProps.source === "google") {
                      const googleEvent = googleEvents.find((event) => event.id === info.event.id);
                      if (googleEvent) openGoogleEvent(googleEvent);
                      return;
                    }
                    if (info.event.extendedProps.source === "planning") {
                      const planningEvent = visiblePlanningEvents.find((event) => event.id === info.event.id);
                      if (planningEvent) openPlanningEvent(planningEvent);
                      return;
                    }
                    const intervention = visibleInterventions.find((item) => item.id === info.event.id);
                    if (intervention) openIntervention(intervention);
                  }}
                  eventDrop={(info: EventDropArg) => {
                    if (info.event.extendedProps.source === "google") return info.revert();
                    if (info.event.extendedProps.source === "planning") {
                      persistPlanningEventDates(info.event.id, info.event.start, info.event.end, info.event.allDay, undefined, info.revert);
                      return;
                    }
                    persistDates(info.event.id, info.event.start, info.event.end, info.revert);
                  }}
                  eventResize={(info: EventResizeDoneArg) => {
                    if (info.event.extendedProps.source === "google") return info.revert();
                    if (info.event.extendedProps.source === "planning") {
                      persistPlanningEventDates(info.event.id, info.event.start, info.event.end, info.event.allDay, undefined, info.revert);
                      return;
                    }
                    persistDates(info.event.id, info.event.start, info.event.end, info.revert);
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

      {slot && <PlanningSlotMenu key={`${slot.start.toISOString()}-${slot.end.toISOString()}`} slot={slot} members={planningMembers} canAssignTeam={teamPlanning} unscheduled={unscheduled} clients={data.clients} onChange={setSlot} onCreate={createFromSlot} onSchedule={scheduleInSlot} onClose={closeSlot} />}

      {panelOpen && <PlanningSidePanel
        title={panelTitle}
        description={panelDescription}
        contentKey={`${panelKey}:${panelRevision}`}
        dirty={panelDirty}
        busy={panelBusy}
        onClose={closePanel}
        onPrevious={panelIndex > 0 ? panelItems[panelIndex - 1]?.open : undefined}
        onNext={panelIndex >= 0 ? panelItems[panelIndex + 1]?.open : undefined}
        actions={currentIntervention?.startAt && currentIntervention.endAt ? <Button size="sm" variant="secondary" disabled={panelBusy || panelDirty} onClick={() => setMoveEditor({ source: "intervention", id: currentIntervention.id })}><CalendarClock className="size-3.5" /> Déplacer</Button> : canMovePlanningEvent && currentPlanningEvent ? <Button size="sm" variant="secondary" disabled={panelBusy || panelDirty} onClick={() => setMoveEditor({ source: "planning", id: currentPlanningEvent.id })}><CalendarClock className="size-3.5" /> Déplacer</Button> : undefined}
      >
      {planningEventEditor && currentUserId && (
        <PlanningEventEditor
          key={`${panelRevision}:${planningEventEditor.event?.id ?? planningEventEditor.start.toISOString()}`}
          embedded
          event={currentPlanningEvent ?? planningEventEditor.event}
          initialStart={planningEventEditor.start}
          initialEnd={planningEventEditor.end}
          initialAllDay={planningEventEditor.allDay}
          initialMemberId={planningEventEditor.memberId}
          initialKind={planningEventEditor.kind}
          currentUserId={currentUserId}
          members={planningMembers}
          canAssignTeam={teamPlanning}
          canEdit={!planningEventEditor.event || teamPlanning || (planningEventEditor.event.memberIds.length === 1 && planningEventEditor.event.memberIds[0] === currentUserId)}
          onDirtyChange={setPanelDirty}
          onSaved={(id) => {
            if (!planningEventEditor.event) {
              setSourceFilter("all");
              setMemberFilter("all");
              const event = useDemoStore.getState().planningEvents.find((item) => item.id === id);
              if (event) { setPanelDirty(false); setPlanningEventEditor({ event, start: new Date(event.startAt) }); }
            }
          }}
          onClose={closePanel}
          onDeleted={clearPanel}
        />
      )}

      {appointmentSlot && <AppointmentForm key={panelRevision} initialSlot={appointmentSlot} allowedMemberIds={planningMembers.map((member) => member.id)} close={clearPanel} onCreated={openCreatedIntervention} onDirtyChange={setPanelDirty} onBusyChange={setPanelBusy} />}
      {selected && <InterventionDetail key={`${selected.id}-${editOnOpen}`} interventionId={selected.id} startEditing={editOnOpen} onDirtyChange={setPanelDirty} />}
        {selectedGoogleEvent && (
          <div className="grid gap-4">
            <p className="rounded-xl border border-sky-100 bg-white p-3 text-sm text-slate-600">Événement synchronisé en lecture seule. Modifiez-le dans Google Calendar, puis actualisez la synchronisation.</p>
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
      </PlanningSidePanel>}

      {movableIntervention?.startAt && movableIntervention.endAt && (
        <PlanningMoveDialog
          key={`move-intervention:${movableIntervention.id}`}
          title={movableIntervention.title}
          start={new Date(movableIntervention.startAt)}
          end={new Date(movableIntervention.endAt)}
          memberId={movableIntervention.workers[0]?.memberId}
          members={planningMembers}
          canAssignTeam={teamPlanning}
          onClose={() => setMoveEditor(null)}
          onMove={(input) => {
            const sourceMemberId = movableIntervention.workers[0]?.memberId;
            const targetMemberId = input.memberId ?? sourceMemberId;
            setMoveEditor(null);
            if (!targetMemberId) return toast.error("Aucun collaborateur n’est affecté à ce rendez-vous.");
            requestInterventionMove({ payload: { interventionId: movableIntervention.id, sourceMemberId }, targetMemberId, start: input.start, end: input.end });
          }}
        />
      )}

      {movablePlanningEvent && (
        <PlanningMoveDialog
          key={`move-event:${movablePlanningEvent.id}`}
          title={movablePlanningEvent.title}
          start={new Date(movablePlanningEvent.startAt)}
          end={new Date(movablePlanningEvent.endAt)}
          allDay={movablePlanningEvent.allDay}
          memberId={movablePlanningEvent.memberIds[0]}
          members={planningMembers}
          canAssignTeam={teamPlanning}
          onClose={() => setMoveEditor(null)}
          onMove={(input) => {
            const sourceMemberId = movablePlanningEvent.memberIds[0];
            const targetMemberId = input.memberId ?? sourceMemberId;
            const nextMemberIds = targetMemberId ? reassignMemberIds(movablePlanningEvent.memberIds, sourceMemberId, targetMemberId) : movablePlanningEvent.memberIds;
            setMoveEditor(null);
            persistPlanningEventDates(movablePlanningEvent.id, input.start, input.end, movablePlanningEvent.allDay, nextMemberIds);
          }}
        />
      )}

      <Modal
        open={Boolean(pendingMove)}
        onClose={() => {
          pendingMove?.cancel?.();
          setPendingMove(null);
        }}
        title="Ce créneau crée un conflit"
        description={pendingMove?.conflicts.length === 1 ? "Un élément occupe déjà ce collaborateur. Rien n’est encore enregistré." : `${pendingMove?.conflicts.length ?? 0} éléments occupent déjà ce collaborateur. Rien n’est encore enregistré.`}
        className="sm:max-w-lg"
      >
        {pendingMove && <div className="grid gap-5">
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div><p className="text-sm font-bold">Vérifiez avant de déplacer</p><p className="mt-1 text-xs leading-5">Nouveau départ : {formatDate(pendingMove.start.toISOString(), { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}</p></div>
          </div>
          <ul className="grid gap-2" aria-label="Éléments en conflit">
            {pendingMove.conflicts.slice(0, 5).map((conflict) => <li key={`${conflict.source}:${conflict.id}`} className="rounded-xl border border-black/[0.08] bg-zinc-50 px-4 py-3"><p className="text-sm font-bold text-slate-900">{conflict.title}</p><p className="mt-1 text-xs text-slate-600">{conflict.source === "google" ? "Google Calendar" : conflict.source === "planning" ? "Événement interne" : "Prestation"} · {formatDate(conflict.startAt, { hour: "2-digit", minute: "2-digit" })}–{formatDate(conflict.endAt, { hour: "2-digit", minute: "2-digit" })}</p></li>)}
            {pendingMove.conflicts.length > 5 && <li className="px-1 text-xs font-semibold text-slate-500">+ {pendingMove.conflicts.length - 5} autre(s) élément(s)</li>}
          </ul>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => { pendingMove.cancel?.(); setPendingMove(null); }}>Garder l’ancien créneau</Button>
            <Button onClick={() => { const apply = pendingMove.apply; setPendingMove(null); apply(); }}>Déplacer quand même</Button>
          </div>
        </div>}
      </Modal>

      <Modal open={Boolean(pendingPanelAction)} onClose={() => setPendingPanelAction(null)} title="Modifications non enregistrées" description="Des champs ont été modifiés dans cette fiche. Voulez-vous quitter sans les enregistrer ?">
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setPendingPanelAction(null)}>Continuer l’édition</Button>
          <Button variant="danger" onClick={() => {
            const action = pendingPanelAction;
            setPendingPanelAction(null);
            setPanelDirty(false);
            action?.();
          }}>Abandonner les modifications</Button>
        </div>
      </Modal>
    </div>
  );
}
