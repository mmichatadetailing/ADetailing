"use client";

import { AlertTriangle, CalendarDays, CalendarPlus2, ChevronLeft, ChevronRight, GripVertical, Link2, UserRound, UsersRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { InterventionDetail } from "@/components/intervention-detail";
import { PageHeader } from "@/components/page-header";
import { planningDragType, TeamPlanningTimeline } from "@/components/team-planning-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useWorkspace } from "@/components/workspace-provider";
import { planningDays, startOfPlanningWeek } from "@/lib/domain/planning-timeline";
import { canViewTeamPlanning, filterPlanningForUser } from "@/lib/domain/planning";
import type { Intervention } from "@/lib/domain/types";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate } from "@/lib/utils";

type PlanningSlot = { start: Date; memberId: string };
type MovePayload = { interventionId: string; sourceMemberId?: string };

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
  const [weekStart, setWeekStart] = useState(() => startOfPlanningWeek(new Date()));
  const [dayCount, setDayCount] = useState<5 | 7>(5);

  const teamPlanning = canViewTeamPlanning(workspace?.role, mode === "demo");
  const currentUserId = workspace?.userId ?? data.team[0]?.id;
  const days = useMemo(() => planningDays(weekStart, dayCount), [dayCount, weekStart]);
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

  const moveWeek = (weeks: number) => {
    setWeekStart((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + weeks * 7);
      return next;
    });
  };

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

  const chooseEmptySlot = (memberId: string, start: Date) => {
    if (unscheduled.length === 0) return;
    setSlot({ memberId, start });
  };

  const scheduleInSlot = (intervention: Intervention) => {
    if (!slot) return;
    moveIntervention({ interventionId: intervention.id }, slot.memberId, slot.start);
    setSlot(null);
  };

  const emptyUnscheduledLabel = teamPlanning
    ? "Toutes les prestations sont planifiées."
    : "Aucune prestation non planifiée ne vous est affectée.";
  const rangeEnd = days.at(-1) ?? weekStart;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={teamPlanning ? "Organisation de l’équipe" : "Mon agenda"}
        title={teamPlanning ? "Planning de l’équipe" : "Mon planning"}
        description={teamPlanning
          ? "Chaque collaborateur dispose de sa ligne. Glissez les prestations dans le temps ou d’une personne à l’autre pour organiser la semaine."
          : "Votre semaine est organisée sur une ligne chronologique, avec uniquement les prestations qui vous sont affectées."}
        actions={<Link href="/parametres#integrations"><Button variant="secondary"><Link2 className="size-4" /> Connecter Google Calendar</Button></Link>}
      />

      <Card className="overflow-hidden bg-[linear-gradient(120deg,rgba(255,255,255,.98),rgba(255,247,237,.72),rgba(245,243,255,.72))]">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
              <Button size="sm" variant="ghost" aria-label="Semaine précédente" onClick={() => moveWeek(-1)}><ChevronLeft className="size-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => setWeekStart(startOfPlanningWeek(new Date()))}>Aujourd’hui</Button>
              <Button size="sm" variant="ghost" aria-label="Semaine suivante" onClick={() => moveWeek(1)}><ChevronRight className="size-4" /></Button>
            </div>
            <div><p className="text-sm font-extrabold capitalize text-zinc-900">{formatDate(weekStart.toISOString(), { day: "2-digit", month: "long" })} — {formatDate(rangeEnd.toISOString(), { day: "2-digit", month: "long", year: "numeric" })}</p><p className="mt-0.5 text-[10px] text-zinc-500">Créneaux de 15 minutes · 7h à 20h</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-zinc-200 bg-white p-1 shadow-sm"><Button size="sm" variant={dayCount === 5 ? "secondary" : "ghost"} onClick={() => setDayCount(5)}>5 jours</Button><Button size="sm" variant={dayCount === 7 ? "secondary" : "ghost"} onClick={() => setDayCount(7)}>7 jours</Button></div>
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
              <p className="mt-2 text-xs leading-5 text-zinc-500">Glissez une carte directement sur la ligne d’un collaborateur, au jour et à l’heure souhaités.</p>
              <div className="mt-4 grid gap-2">
                {unscheduled.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-5 text-center text-xs text-zinc-500">{emptyUnscheduledLabel}</p> : unscheduled.map((item) => {
                  const client = data.clients.find((entry) => entry.id === item.clientId);
                  const vehicle = data.vehicles.find((entry) => entry.id === item.vehicleId);
                  return (
                    <button
                      key={item.id}
                      draggable
                      type="button"
                      onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(planningDragType, JSON.stringify({ interventionId: item.id } satisfies MovePayload)); }}
                      onClick={() => setSelected(item)}
                      className="focus-ring surface-interactive cursor-grab rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-sm active:cursor-grabbing"
                    >
                      <div className="flex items-start gap-2"><GripVertical className="mt-0.5 size-3.5 text-zinc-400" /><div className="min-w-0"><p className="truncate text-xs font-bold text-zinc-900">{client?.company || `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim()}</p><p className="mt-1 truncate text-[11px] text-zinc-500">{vehicle ? `${vehicle.make} ${vehicle.model}` : item.vehicleFormat || "Véhicule non renseigné"}</p><p className="mt-2 text-[10px] font-bold text-brand-600">{item.plannedDurationMinutes / 60} h · {item.workers.length || 1} pers.</p></div></div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 text-[11px] leading-5 text-sky-800"><strong>Astuce :</strong> sur mobile, faites défiler la frise horizontalement. La colonne des collaborateurs et les jours restent visibles pendant le défilement.</div>
        </aside>

        <div className="min-w-0">
          <TeamPlanningTimeline
            members={planningMembers}
            interventions={scheduled}
            clients={data.clients}
            days={days}
            conflictIds={conflictIds}
            currentUserId={currentUserId}
            onSelect={setSelected}
            onMove={moveIntervention}
            onEmptySlot={chooseEmptySlot}
          />
        </div>
      </div>

      <Modal open={Boolean(slot)} onClose={() => setSlot(null)} title="Planifier sur ce créneau" description={slot ? `${data.team.find((member) => member.id === slot.memberId)?.firstName ?? "Collaborateur"} · ${formatDate(slot.start.toISOString(), { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}` : undefined}>
        <div className="grid gap-2">
          {unscheduled.map((item) => <button key={item.id} onClick={() => scheduleInSlot(item)} className="focus-ring surface-interactive flex items-center justify-between gap-4 rounded-xl border border-zinc-200 p-4 text-left"><span><span className="block text-sm font-bold">{item.title}</span><span className="mt-1 block text-xs text-zinc-500">{item.plannedDurationMinutes / 60} h · {item.address}</span></span><CalendarDays className="size-4 text-brand-500" /></button>)}
        </div>
      </Modal>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title ?? "Dossier prestation"} description="Rendez-vous · réalisation · facture · paiement" className="sm:max-w-5xl">
        {selected && <InterventionDetail key={selected.id} interventionId={selected.id} />}
      </Modal>
    </div>
  );
}
