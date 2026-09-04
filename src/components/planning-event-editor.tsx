"use client";

import { CalendarClock, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import type { PlanningEvent, PlanningEventKind, TeamMember } from "@/lib/domain/types";
import { useDemoStore } from "@/lib/demo/store";

const kindOptions: Array<{ value: PlanningEventKind; label: string }> = [
  { value: "meeting", label: "Réunion" },
  { value: "unavailability", label: "Indisponibilité" },
  { value: "absence", label: "Absence" },
  { value: "personal", label: "Bloc personnel" },
];

const kindColors: Record<PlanningEventKind, string> = {
  meeting: "#8b5cf6",
  unavailability: "#f59e0b",
  absence: "#ef4444",
  personal: "#64748b",
};

function localDateTime(value: string | Date) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function localDate(value: string | Date, exclusiveEnd = false) {
  const date = new Date(value);
  if (exclusiveEnd) date.setDate(date.getDate() - 1);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function isoFromLocal(value: string) {
  return new Date(value).toISOString();
}

export function PlanningEventEditor({
  event,
  initialStart,
  currentUserId,
  members,
  canAssignTeam,
  canEdit,
  onClose,
}: {
  event?: PlanningEvent;
  initialStart: Date;
  currentUserId: string;
  members: TeamMember[];
  canAssignTeam: boolean;
  canEdit: boolean;
  onClose: () => void;
}) {
  const data = useDemoStore();
  const defaultEnd = new Date(initialStart.getTime() + 60 * 60_000);
  const [kind, setKind] = useState<PlanningEventKind>(event?.kind ?? "meeting");
  const [title, setTitle] = useState(event?.title ?? "");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [start, setStart] = useState(event ? (event.allDay ? localDate(event.startAt) : localDateTime(event.startAt)) : localDateTime(initialStart));
  const [end, setEnd] = useState(event ? (event.allDay ? localDate(event.endAt, true) : localDateTime(event.endAt)) : localDateTime(defaultEnd));
  const [memberIds, setMemberIds] = useState<string[]>(event?.memberIds ?? [currentUserId]);
  const [location, setLocation] = useState(event?.location ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");

  const changeAllDay = (checked: boolean) => {
    setAllDay(checked);
    if (checked) {
      setStart(start.slice(0, 10));
      setEnd(end.slice(0, 10));
    } else {
      setStart(`${start.slice(0, 10)}T09:00`);
      setEnd(`${end.slice(0, 10)}T10:00`);
    }
  };

  const toggleMember = (memberId: string) => {
    if (!canAssignTeam) return;
    setMemberIds((current) => current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId]);
  };

  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!canEdit) return;
    if (title.trim().length < 2) return toast.error("Donnez un titre à l’événement.");
    if (memberIds.length === 0) return toast.error("Choisissez au moins un collaborateur.");
    const startAt = allDay ? isoFromLocal(`${start}T00:00`) : isoFromLocal(start);
    let endAt: string;
    if (allDay) {
      const exclusiveEnd = new Date(`${end}T00:00`);
      exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
      endAt = exclusiveEnd.toISOString();
    } else {
      endAt = isoFromLocal(end);
    }
    if (new Date(endAt) <= new Date(startAt)) return toast.error("L’heure de fin doit être après le début.");
    const input = { kind, title, startAt, endAt, allDay, memberIds, location, notes, color: kindColors[kind] };
    if (event) data.updatePlanningEvent(event.id, input);
    else data.addPlanningEvent(input);
    toast.success(event ? "Événement modifié" : "Événement ajouté au planning");
    onClose();
  };

  const remove = () => {
    if (!event || !window.confirm(`Supprimer « ${event.title} » du planning ?`)) return;
    data.removePlanningEvent(event.id);
    toast.success("Événement supprimé");
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={event ? (canEdit ? "Modifier l’événement" : "Détail de l’événement") : "Ajouter un événement"} description="Réunion, absence ou bloc horaire sans créer de prestation.">
      <form onSubmit={submit} className="grid gap-4">
        <fieldset disabled={!canEdit} className="grid gap-4 disabled:opacity-70">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select value={kind} onChange={(input) => setKind(input.target.value as PlanningEventKind)}>
              {kindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
          <Field label="Titre">
            <Input value={title} onChange={(input) => setTitle(input.target.value)} placeholder="Réunion d’équipe…" autoFocus />
          </Field>
        </div>

        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm font-semibold text-zinc-700">
          <input type="checkbox" checked={allDay} onChange={(input) => changeAllDay(input.target.checked)} className="size-4 accent-violet-500" />
          Toute la journée
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={allDay ? "Du" : "Début"}>
            <Input type={allDay ? "date" : "datetime-local"} value={start} onChange={(input) => setStart(input.target.value)} required />
          </Field>
          <Field label={allDay ? "Au" : "Fin"}>
            <Input type={allDay ? "date" : "datetime-local"} value={end} onChange={(input) => setEnd(input.target.value)} min={start} required />
          </Field>
        </div>

        <Field label={canAssignTeam ? "Collaborateurs concernés" : "Collaborateur"}>
          <div className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-3">
            {members.map((member) => {
              const selected = memberIds.includes(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleMember(member.id)}
                  disabled={!canAssignTeam && member.id !== currentUserId}
                  className={`focus-ring rounded-lg border px-3 py-2 text-xs font-bold transition ${selected ? "border-violet-300 bg-violet-50 text-violet-700" : "border-zinc-200 bg-white text-zinc-600 hover:border-violet-200"}`}
                >
                  {member.firstName} {member.lastName}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Lieu (facultatif)"><Input value={location} onChange={(input) => setLocation(input.target.value)} placeholder="Atelier, visioconférence…" /></Field>
        <Field label="Notes (facultatif)"><Textarea value={notes} onChange={(input) => setNotes(input.target.value)} className="min-h-20" /></Field>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div>{event && canEdit && <Button type="button" variant="danger" onClick={remove}><Trash2 className="size-4" /> Supprimer</Button>}</div>
          <div className="flex gap-2"><Button type="button" variant="ghost" onClick={onClose}>{canEdit ? "Annuler" : "Fermer"}</Button>{canEdit && <Button type="submit"><CalendarClock className="size-4" /> {event ? "Enregistrer" : "Ajouter"}</Button>}</div>
        </div>
      </form>
    </Modal>
  );
}
