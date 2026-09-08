"use client";

import { ArrowLeft, CalendarCheck2, CalendarPlus2, ChevronRight, Clock3, Coffee, LockKeyhole, Search, UsersRound } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { appointmentSlotDefaults, localPlanningDateTime, type PlanningSlot } from "@/lib/domain/planning-slot";
import type { Client, Intervention, PlanningEventKind, TeamMember } from "@/lib/domain/types";
import { formatDate } from "@/lib/utils";

const actions = [
  { kind: "appointment", label: "Nouvelle prestation", description: "Créer un rendez-vous pour un client", icon: CalendarPlus2, color: "bg-orange-50 text-orange-700" },
  { kind: "unavailability", label: "Indisponibilité", description: "Réserver ce temps sans prestation", icon: LockKeyhole, color: "bg-amber-50 text-amber-800" },
  { kind: "absence", label: "Absence", description: "Congé ou absence du collaborateur", icon: Coffee, color: "bg-red-50 text-red-700" },
  { kind: "personal", label: "Bloc personnel", description: "Ajouter un bloc à votre planning", icon: Clock3, color: "bg-slate-100 text-slate-700" },
  { kind: "meeting", label: "Réunion", description: "Prévoir un temps avec l’équipe", icon: UsersRound, color: "bg-violet-50 text-violet-700" },
] as const;

export function PlanningSlotMenu({ slot, members, canAssignTeam, unscheduled, clients, onChange, onCreate, onSchedule, onClose }: {
  slot: PlanningSlot;
  members: TeamMember[];
  canAssignTeam: boolean;
  unscheduled: Intervention[];
  clients: Client[];
  onChange: (slot: PlanningSlot) => void;
  onCreate: (kind: "appointment" | PlanningEventKind) => void;
  onSchedule: (intervention: Intervention, start: Date, durationMinutes: number) => void;
  onClose: () => void;
}) {
  const [existing, setExisting] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const defaults = appointmentSlotDefaults(slot);
  const [start, setStart] = useState(() => localPlanningDateTime(defaults.start));
  const [hours, setHours] = useState(defaults.durationMinutes / 60);
  const selected = unscheduled.find((item) => item.id === selectedId);
  const clientName = (item: Intervention) => {
    const client = clients.find((entry) => entry.id === item.clientId);
    return client?.company || `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim();
  };
  const matches = unscheduled.filter((item) => `${item.title} ${clientName(item)}`.toLocaleLowerCase("fr-FR").includes(query.toLocaleLowerCase("fr-FR")));
  const endDay = new Date(slot.end);
  if (slot.allDay) endDay.setDate(endDay.getDate() - 1);
  const period = slot.allDay
    ? `${formatDate(slot.start.toISOString(), { day: "numeric", month: "long", year: "numeric" })}${endDay.toDateString() !== slot.start.toDateString() ? ` — ${formatDate(endDay.toISOString(), { day: "numeric", month: "long", year: "numeric" })}` : ""} · Journée entière`
    : `${formatDate(slot.start.toISOString(), { weekday: "long", day: "numeric", month: "long" })} · ${formatDate(slot.start.toISOString(), { hour: "2-digit", minute: "2-digit" })} — ${formatDate(slot.end.toISOString(), { ...(slot.end.toDateString() !== slot.start.toDateString() ? { day: "numeric", month: "short" } as const : {}), hour: "2-digit", minute: "2-digit" })}`;
  const validDuration = Number.isFinite(hours) && hours >= 0.25 && hours <= 24;

  return (
    <Modal open onClose={onClose} title={existing ? "Planifier une prestation existante" : "Ajouter sur ce créneau"} description={period}>
      <div className="grid gap-4">
        {canAssignTeam ? <Field label="Collaborateur"><Select autoFocus value={slot.memberId} onChange={(event) => onChange({ ...slot, memberId: event.target.value })}>{members.filter((member) => member.active).map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}</Select></Field>
          : <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{members.find((member) => member.id === slot.memberId)?.firstName} · Mon planning</p>}
        {slot.allDay && <p className="text-xs text-slate-600">Pour une prestation, l’horaire proposé est 9 h et reste modifiable. Pour une absence ou un événement, la journée entière est conservée.</p>}
        {!existing ? <div className="grid gap-2">
          {actions.map(({ kind, label, description, icon: Icon, color }) => <button type="button" key={kind} autoFocus={!canAssignTeam && kind === "appointment"} disabled={kind === "appointment" && defaults.durationMinutes > 1440} onClick={() => onCreate(kind)} className="focus-ring group flex items-center gap-3 rounded-xl border border-black/[.08] bg-white p-3 text-left transition hover:border-brand-400/40 hover:bg-orange-50/40 disabled:opacity-50">
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${color}`}><Icon className="size-5" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-900">{label}</span><span className="block text-xs text-slate-600">{kind === "appointment" && defaults.durationMinutes > 1440 ? "Sélectionnez un créneau de 24 h maximum" : description}</span></span>
            <ChevronRight className="size-4 shrink-0 text-slate-400 group-hover:text-brand-600" />
          </button>)}
          <button type="button" onClick={() => setExisting(true)} className="focus-ring mt-1 flex items-center gap-3 rounded-xl border border-dashed border-slate-300 p-3 text-left hover:border-brand-400 hover:bg-orange-50/40">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700"><CalendarCheck2 className="size-5" /></span>
            <span className="flex-1 text-sm font-bold text-slate-900">Planifier une prestation existante<span className="block text-xs font-normal text-slate-600">{unscheduled.length} prestation(s) en attente</span></span><ChevronRight className="size-4 shrink-0 text-slate-400" />
          </button>
        </div> : <>
          <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setExisting(false)}><ArrowLeft className="size-4" /> Autre type d’ajout</Button>
          {unscheduled.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-600">Aucune prestation en attente de planification. Vous pouvez créer une nouvelle prestation.</p> : <>
            <Field label="Rechercher une prestation"><div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" /><Input autoFocus className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Client, formule…" /></div></Field>
            <div className="grid max-h-48 gap-2 overflow-y-auto">
              {matches.length === 0 && <p className="p-3 text-sm text-slate-500">Aucune prestation ne correspond.</p>}
              {matches.map((item) => <button type="button" key={item.id} aria-pressed={selectedId === item.id} onClick={() => { setSelectedId(item.id); setHours(slot.durationSelected && !slot.allDay ? defaults.durationMinutes / 60 : item.plannedDurationMinutes / 60); }} className={`focus-ring rounded-xl border p-3 text-left ${selectedId === item.id ? "border-brand-400 bg-orange-50" : "border-slate-200 hover:bg-slate-50"}`}><span className="block text-sm font-bold text-slate-900">{item.title}</span><span className="text-xs text-slate-600">{clientName(item)} · {item.plannedDurationMinutes / 60} h prévues</span></button>)}
            </div>
            {selected && <form className="grid gap-3 rounded-xl bg-slate-50 p-3" onSubmit={(event) => { event.preventDefault(); if (validDuration && Number.isFinite(new Date(start).getTime())) onSchedule(selected, new Date(start), Math.round(hours * 60)); }}>
              <Field label="Début de la prestation"><Input type="datetime-local" required value={start} onChange={(event) => setStart(event.target.value)} /></Field>
              <Field label="Durée prévue (h)"><Input type="number" required min="0.25" max="24" step="0.25" value={hours} onChange={(event) => setHours(Number(event.target.value))} /></Field>
              <Button type="submit" disabled={!validDuration}>Confirmer la planification</Button>
            </form>}
          </>}
        </>}
      </div>
    </Modal>
  );
}
