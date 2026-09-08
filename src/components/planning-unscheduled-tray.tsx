"use client";

import { CalendarPlus2, ChevronDown, GripVertical, UserRound } from "lucide-react";
import { forwardRef } from "react";
import type { Client, Intervention, TeamMember, Vehicle } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { planningDragType } from "@/components/team-planning-timeline";

type MovePayload = { interventionId: string };

function clientName(intervention: Intervention, clients: Client[]) {
  const client = clients.find((entry) => entry.id === intervention.clientId);
  return client?.company || `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim() || "Client non renseigné";
}

function vehicleName(intervention: Intervention, vehicles: Vehicle[]) {
  const vehicle = vehicles.find((entry) => entry.id === intervention.vehicleId);
  return vehicle ? `${vehicle.make} ${vehicle.model}` : intervention.vehicleFormat || "Véhicule non renseigné";
}

export const PlanningUnscheduledTray = forwardRef<HTMLElement, {
  interventions: Intervention[];
  clients: Client[];
  vehicles: Vehicle[];
  members: TeamMember[];
  expanded: boolean;
  canDrag: boolean;
  teamPlanning: boolean;
  onToggle: () => void;
  onOpen: (intervention: Intervention) => void;
}>(function PlanningUnscheduledTray({ interventions, clients, vehicles, members, expanded, canDrag, teamPlanning, onToggle, onOpen }, ref) {
  const title = teamPlanning ? "Prestations non planifiées" : "Mes prestations à planifier";

  return (
    <aside ref={ref} id="planning-unscheduled" tabIndex={-1} aria-labelledby="planning-unscheduled-title" className="scroll-mt-[calc(var(--app-header-height)+170px)] overflow-hidden rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50/90 via-white to-orange-50/70 shadow-[0_7px_24px_rgba(120,85,40,.08)]">
      <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls="planning-unscheduled-items" className="focus-ring flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-amber-50/70">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><CalendarPlus2 className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span id="planning-unscheduled-title" className="block truncate text-sm font-extrabold text-slate-900">{title}</span>
          <span className="block truncate text-[11px] text-slate-600">{expanded ? (canDrag ? "Glissez une carte vers la timeline ou ouvrez sa fiche." : "Ouvrez une fiche pour compléter sa planification.") : "Le calendrier conserve toute sa largeur."}</span>
        </span>
        <span className="shrink-0 rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-extrabold text-amber-800">{interventions.length}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-slate-500 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div id="planning-unscheduled-items" className="planning-unscheduled-items border-t border-amber-200/70 px-3 py-3">
          <ul className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-1">
            {interventions.map((intervention) => {
              const assigned = intervention.workers.map((worker) => members.find((member) => member.id === worker.memberId)).filter((member): member is TeamMember => Boolean(member));
              const workerLabel = assigned.length ? `${assigned[0]!.firstName}${assigned.length > 1 ? ` +${assigned.length - 1}` : ""}` : "Équipe à définir";
              return (
                <li key={intervention.id} className="w-[230px] shrink-0 snap-start">
                <button
                  type="button"
                  draggable={canDrag}
                  onDragStart={(event) => {
                    if (!canDrag) return event.preventDefault();
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(planningDragType, JSON.stringify({ interventionId: intervention.id } satisfies MovePayload));
                  }}
                  onClick={() => onOpen(intervention)}
                  className={cn("focus-ring surface-interactive group flex h-full w-full items-start gap-2.5 rounded-xl border border-black/[.08] bg-white p-3 text-left shadow-sm", canDrag && "cursor-grab active:cursor-grabbing")}
                >
                  <GripVertical className={cn("mt-0.5 size-3.5 shrink-0 text-slate-300 transition-colors", canDrag && "group-hover:text-amber-600")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-extrabold text-slate-900">{clientName(intervention, clients)}</span>
                    <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-600">{intervention.title}</span>
                    <span className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                      <span className="min-w-0 truncate">{vehicleName(intervention, vehicles)}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 font-bold text-amber-800"><UserRound className="size-3" /> {workerLabel}</span>
                    </span>
                    <span className="mt-1 block text-[10px] font-bold text-brand-600">{intervention.plannedDurationMinutes / 60} h prévues</span>
                  </span>
                </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
});
