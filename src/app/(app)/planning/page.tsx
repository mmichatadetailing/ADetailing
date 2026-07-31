"use client";

import type { DateSelectArg, EventClickArg, EventDropArg } from "@fullcalendar/core";
import frLocale from "@fullcalendar/core/locales/fr";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { Draggable, type EventReceiveArg, type EventResizeDoneArg } from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { AlertTriangle, CalendarDays, CalendarPlus2, GripVertical, Link2, UserRound, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { InterventionDetail } from "@/components/intervention-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useWorkspace } from "@/components/workspace-provider";
import { useDemoStore } from "@/lib/demo/store";
import { dateKey } from "@/lib/domain/periods";
import { canViewTeamPlanning, filterPlanningForUser } from "@/lib/domain/planning";
import type { Intervention } from "@/lib/domain/types";
import { formatDate } from "@/lib/utils";

export default function PlanningPage() {
  const data = useDemoStore();
  const { mode, workspace } = useWorkspace();
  const externalRef = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [selected, setSelected] = useState<Intervention | null>(null);

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

  const conflicts = useMemo(() => scheduled.flatMap((item, index) => scheduled.slice(index + 1).filter((other) => {
    if (!item.startAt || !item.endAt || !other.startAt || !other.endAt) return false;
    const sameWorker = item.workers.some((worker) => other.workers.some((entry) => entry.memberId === worker.memberId));
    return sameWorker && new Date(item.startAt) < new Date(other.endAt) && new Date(other.startAt) < new Date(item.endAt);
  }).map((other) => [item.id, other.id] as const)), [scheduled]);

  useEffect(() => {
    if (!externalRef.current) return;
    const draggable = new Draggable(externalRef.current, {
      itemSelector: ".external-intervention",
      eventData: (element) => ({
        id: element.dataset.id,
        title: element.dataset.title,
        duration: element.dataset.duration,
        backgroundColor: "#f97316",
        borderColor: "transparent",
      }),
    });
    return () => draggable.destroy();
  }, [unscheduled.length]);

  const eventInput = useMemo(() => scheduled.map((item) => {
    const assignedMembers = item.workers
      .map((worker) => data.team.find((member) => member.id === worker.memberId))
      .filter((member) => Boolean(member));
    const colorMember = teamPlanning
      ? assignedMembers[0]
      : assignedMembers.find((member) => member?.id === currentUserId);
    const client = data.clients.find((entry) => entry.id === item.clientId);
    const workerNames = assignedMembers.map((member) => member?.firstName).filter(Boolean).join(", ");
    return {
      id: item.id,
      title: `${client?.company || client?.firstName} · ${item.title.split("—")[0]?.trim()}${workerNames ? ` · ${workerNames}` : ""}`,
      start: item.startAt,
      end: item.endAt,
      backgroundColor: `${colorMember?.color ?? "#f97316"}cc`,
      borderColor: "transparent",
      extendedProps: { status: item.status },
    };
  }), [currentUserId, data.clients, data.team, scheduled, teamPlanning]);

  const persistDates = (id: string, start: Date | null, end: Date | null) => {
    if (!start) return;
    const fallbackEnd = new Date(start.getTime() + (visibleInterventions.find((item) => item.id === id)?.plannedDurationMinutes ?? 120) * 60_000);
    data.rescheduleIntervention(id, start.toISOString(), (end ?? fallbackEnd).toISOString());
    toast.success("Planning mis à jour");
  };

  const scheduleInSlot = (intervention: Intervention) => {
    if (!slot) return;
    const end = new Date(slot.start.getTime() + intervention.plannedDurationMinutes * 60_000);
    data.rescheduleIntervention(intervention.id, slot.start.toISOString(), end.toISOString());
    setSlot(null);
    toast.success("Prestation planifiée");
  };

  const emptyUnscheduledLabel = teamPlanning
    ? "Toutes les prestations sont planifiées."
    : "Aucune prestation non planifiée ne vous est affectée.";

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={teamPlanning ? "Calendrier de l’équipe" : "Mon agenda"}
        title={teamPlanning ? "Planning de l’équipe" : "Mon planning"}
        description={teamPlanning
          ? "Toutes les interventions de l’équipe sont réunies ici. Déplacez-les pour ajuster l’organisation."
          : "Seules les interventions auxquelles vous êtes affecté sont affichées dans votre planning."}
        actions={<Link href="/parametres#integrations"><Button variant="secondary"><Link2 className="size-4" /> Connecter Google Calendar</Button></Link>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={teamPlanning ? "blue" : "green"}>
          {teamPlanning ? <UsersRound className="mr-1.5 size-3" /> : <UserRound className="mr-1.5 size-3" />}
          {teamPlanning ? "Vue équipe" : "Vue personnelle"}
        </Badge>
        {planningMembers.map((member) => (
          <Badge key={member.id}>
            <span className="mr-1.5 size-2 rounded-full" style={{ backgroundColor: member.color }} />
            {member.firstName}{member.id === workspace?.userId ? " · Vous" : ""}
          </Badge>
        ))}
        {conflicts.length > 0 && <Badge variant="red"><AlertTriangle className="mr-1 size-3" /> {conflicts.length} conflit(s)</Badge>}
        <Badge variant="orange">{unscheduled.length} à planifier</Badge>
      </div>

      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside ref={externalRef} className="space-y-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <CalendarPlus2 className="size-4 text-brand-400" />
                <h2 className="text-sm font-bold">{teamPlanning ? "Non planifiées" : "À planifier pour moi"}</h2>
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-600">Glissez une carte dans le calendrier ou cliquez sur un créneau.</p>
              <div className="mt-4 grid gap-2">
                {unscheduled.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-zinc-600">{emptyUnscheduledLabel}</p>
                ) : unscheduled.map((item) => {
                  const client = data.clients.find((entry) => entry.id === item.clientId);
                  const vehicle = data.vehicles.find((entry) => entry.id === item.vehicleId);
                  return (
                    <button
                      key={item.id}
                      data-id={item.id}
                      data-title={item.title}
                      data-duration={`0${Math.floor(item.plannedDurationMinutes / 60)}:${String(item.plannedDurationMinutes % 60).padStart(2, "0")}`}
                      onClick={() => setSelected(item)}
                      className="external-intervention focus-ring surface-interactive cursor-grab rounded-xl border border-white/[0.075] bg-white/[0.035] p-3 text-left active:cursor-grabbing"
                    >
                      <div className="flex items-start gap-2">
                        <GripVertical className="mt-0.5 size-3.5 text-zinc-700" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold">{client?.company || `${client?.firstName} ${client?.lastName}`}</p>
                          <p className="mt-1 truncate text-[11px] text-zinc-500">{vehicle?.make} {vehicle?.model}</p>
                          <p className="mt-2 text-[10px] text-brand-400">{item.plannedDurationMinutes / 60} h · {item.workers.length} pers.</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs font-semibold"><UsersRound className="size-4 text-sky-300" /> Synchronisation Google</div>
              <p className="mt-2 text-[11px] leading-5 text-zinc-600">Votre calendrier personnel peut être connecté sans exposer le détail des événements privés.</p>
            </CardContent>
          </Card>
        </aside>

        <Card className="min-w-0">
          <CardContent className="p-3 sm:p-5">
            <FullCalendar
              plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
              locales={[frLocale]}
              locale="fr"
              initialView="timeGridWeek"
              initialDate={dateKey(new Date())}
              headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" }}
              buttonText={{ today: "Aujourd’hui", month: "Mois", week: "Semaine", day: "Jour", list: "Liste" }}
              allDaySlot={false}
              nowIndicator
              editable
              selectable={unscheduled.length > 0}
              droppable={unscheduled.length > 0}
              height="auto"
              slotMinTime="07:00:00"
              slotMaxTime="20:00:00"
              slotDuration="00:30:00"
              events={eventInput}
              select={(info: DateSelectArg) => setSlot({ start: info.start, end: info.end })}
              eventDrop={(info: EventDropArg) => persistDates(info.event.id, info.event.start, info.event.end)}
              eventResize={(info: EventResizeDoneArg) => persistDates(info.event.id, info.event.start, info.event.end)}
              eventReceive={(info: EventReceiveArg) => persistDates(info.event.id, info.event.start, info.event.end)}
              eventClick={(info: EventClickArg) => setSelected(scheduled.find((item) => item.id === info.event.id) ?? null)}
            />
          </CardContent>
        </Card>
      </div>

      <Modal
        open={Boolean(slot)}
        onClose={() => setSlot(null)}
        title="Planifier sur ce créneau"
        description={slot ? formatDate(slot.start.toISOString(), { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }) : undefined}
      >
        <div className="grid gap-2">
          {unscheduled.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-600">{emptyUnscheduledLabel}</p>
          ) : unscheduled.map((item) => (
            <button key={item.id} onClick={() => scheduleInSlot(item)} className="focus-ring surface-interactive flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] p-4 text-left">
              <span>
                <span className="block text-sm font-bold">{item.title}</span>
                <span className="mt-1 block text-xs text-zinc-600">{item.plannedDurationMinutes / 60} h · {item.address}</span>
              </span>
              <CalendarDays className="size-4 text-brand-400" />
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title ?? "Dossier prestation"} description="Rendez-vous · réalisation · facture · paiement" className="sm:max-w-5xl">
        {selected && <InterventionDetail key={selected.id} interventionId={selected.id} />}
      </Modal>
    </div>
  );
}
