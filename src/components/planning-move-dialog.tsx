"use client";

import { CalendarClock, MoveRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import type { TeamMember } from "@/lib/domain/types";
import { formatDate } from "@/lib/utils";

function localParts(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

export function PlanningMoveDialog({
  title,
  start,
  end,
  allDay = false,
  memberId,
  members,
  canAssignTeam,
  onClose,
  onMove,
}: {
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  memberId?: string;
  members: TeamMember[];
  canAssignTeam: boolean;
  onClose: () => void;
  onMove: (input: { start: Date; end: Date; memberId?: string }) => void;
}) {
  const initial = localParts(start);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [selectedMemberId, setSelectedMemberId] = useState(memberId ?? members.find((member) => member.active)?.id ?? "");
  const initialDurationMinutes = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000));
  const [duration, setDuration] = useState(allDay ? Math.max(1, Math.round(initialDurationMinutes / 1_440)) : initialDurationMinutes / 60);

  const submit = () => {
    if (!date || (!allDay && !time)) return;
    const nextStart = new Date(allDay ? `${date}T00:00:00` : `${date}T${time}`);
    const amount = Number(duration);
    if (!Number.isFinite(nextStart.getTime()) || !Number.isFinite(amount) || amount <= 0) return;
    const durationMinutes = allDay ? Math.max(1, Math.round(amount)) * 1_440 : Math.max(15, Math.round(amount * 60));
    onMove({ start: nextStart, end: new Date(nextStart.getTime() + durationMinutes * 60_000), memberId: selectedMemberId || undefined });
  };

  const selectedMember = members.find((member) => member.id === selectedMemberId);
  return (
    <Modal open onClose={onClose} title={`Déplacer · ${title}`} description="Choisissez le nouveau créneau. Le planning vérifiera les chevauchements avant d’enregistrer." className="sm:max-w-lg">
      <div className="grid gap-5">
        <div className="rounded-2xl border border-orange-100 bg-orange-50/70 p-4 text-sm text-slate-700">
          <p className="flex items-center gap-2 font-bold text-slate-900"><CalendarClock className="size-4 text-brand-500" /> Nouveau créneau</p>
          <p className="mt-1 text-xs leading-5">Actuellement : {formatDate(start.toISOString(), { weekday: "long", day: "2-digit", month: "long", hour: allDay ? undefined : "2-digit", minute: allDay ? undefined : "2-digit" })}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
          {!allDay && <Field label="Heure"><Input type="time" step="900" value={time} onChange={(event) => setTime(event.target.value)} /></Field>}
          <Field label={allDay ? "Durée (jours)" : "Durée (heures)"}>
            <Input type="number" min={allDay ? 1 : 0.25} max={allDay ? 30 : 24} step={allDay ? 1 : 0.25} value={duration} onChange={(event) => setDuration(Number(event.target.value))} />
          </Field>
          {members.length > 0 && (
            <Field label="Collaborateur" hint={!canAssignTeam ? "Votre planning uniquement" : selectedMember ? `Déplacer sur le planning de ${selectedMember.firstName}` : undefined}>
              <Select value={selectedMemberId} disabled={!canAssignTeam} onChange={(event) => setSelectedMemberId(event.target.value)}>
                {members.filter((member) => member.active || member.id === memberId).map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}
              </Select>
            </Field>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={submit}><MoveRight className="size-4" /> Vérifier et déplacer</Button>
        </div>
      </div>
    </Modal>
  );
}
