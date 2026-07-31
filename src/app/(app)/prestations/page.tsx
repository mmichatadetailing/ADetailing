"use client";

import { AlertTriangle, Camera, CheckCircle2, Clock3, MapPin, Play, Search, Square, TimerReset, UsersRound } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { actualPersonMinutes, grossMargin, hourlyMargin } from "@/lib/domain/calculations";
import { interventionStatusLabels } from "@/lib/domain/labels";
import type { Intervention, InterventionStatus } from "@/lib/domain/types";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney, normalizeText } from "@/lib/utils";

function InterventionDetail({ intervention, close }: { intervention: Intervention; close: () => void }) {
  const data = useDemoStore();
  const current = data.interventions.find((item) => item.id === intervention.id) ?? intervention;
  const client = data.clients.find((item) => item.id === current.clientId);
  const vehicle = data.vehicles.find((item) => item.id === current.vehicleId);
  const setStatus = data.setInterventionStatus;
  const incrementChecklist = data.incrementChecklist;
  const updateActuals = data.updateInterventionActuals;
  const [actualHours, setActualHours] = useState((current.actualDurationMinutes ?? current.plannedDurationMinutes) / 60);
  const [productEuros, setProductEuros] = useState(current.productCost / 100);
  const [travelEuros, setTravelEuros] = useState(current.travelCost / 100);
  const [otherEuros, setOtherEuros] = useState(current.otherDirectCosts / 100);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Array<{ name: string; size: number }>>([]);
  const [workerHours, setWorkerHours] = useState<Record<string, number>>(
    Object.fromEntries(current.workers.map((worker) => [worker.memberId, (worker.actualMinutes ?? worker.plannedMinutes) / 60])),
  );
  const margin = grossMargin(current);
  const hourly = hourlyMargin(current);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={current.status}>{interventionStatusLabels[current.status]}</StatusBadge><Badge>{vehicle?.make} {vehicle?.model}</Badge><Badge>{vehicle?.registration}</Badge></div>
      <div className="grid gap-3 sm:grid-cols-3">{[
        ["Revenu affecté", formatMoney(current.items.reduce((sum, item) => sum + item.revenueAllocated, 0))], ["Marge brute", formatMoney(margin)], ["Marge horaire", hourly === null ? "À calculer" : `${formatMoney(hourly)}/h`],
      ].map(([label, value]) => <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-[10px] font-bold tracking-wider text-zinc-600 uppercase">{label}</p><p className="mt-2 text-lg font-bold">{value}</p></div>)}</div>
      <section className="rounded-2xl border border-white/[0.07] p-4"><div className="flex items-center justify-between"><div><p className="text-sm font-bold">Checklist opérationnelle</p><p className="mt-1 text-xs text-zinc-600">{current.checklistDone} sur {current.checklistTotal} étapes</p></div><Button size="sm" variant="secondary" disabled={current.checklistDone >= current.checklistTotal} onClick={() => incrementChecklist(current.id)}><CheckCircle2 className="size-3.5" /> Valider l’étape suivante</Button></div><Progress value={current.checklistTotal ? current.checklistDone / current.checklistTotal * 100 : 0} className="mt-4" /></section>
      <section><h3 className="mb-3 text-sm font-bold">Planning & équipe</h3><div className="grid gap-3 rounded-2xl border border-white/[0.07] p-4 sm:grid-cols-2"><div><p className="text-xs text-zinc-600">Créneau</p><p className="mt-1 text-sm font-semibold">{formatDate(current.startAt, { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}</p></div><div><p className="text-xs text-zinc-600">Adresse</p><a target="_blank" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(current.address)}`} className="mt-1 block text-sm font-semibold text-brand-400 hover:underline">{current.address}</a></div><div className="sm:col-span-2"><p className="mb-2 text-xs text-zinc-600">Collaborateurs</p><div className="flex flex-wrap gap-2">{current.workers.map((worker) => { const member = data.team.find((item) => item.id === worker.memberId); return <div key={worker.memberId} className="flex items-center gap-2 rounded-xl bg-white/[0.04] p-2 pr-3"><Avatar label={member?.initials ?? "?"} color={member?.color} size="sm" /><span className="text-xs font-semibold">{member?.firstName} · {(worker.actualMinutes ?? worker.plannedMinutes) / 60} h</span></div>; })}</div></div></div></section>
      {current.status === "in_progress" || current.status === "completed" ? <section className="rounded-2xl border border-white/[0.07] bg-white/[0.018] p-4"><h3 className="text-sm font-bold">Temps réel & coûts directs</h3><p className="mt-1 text-xs text-zinc-600">Les heures individuelles alimentent les heures-personnes et la marge horaire.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Durée calendaire réelle (h)"><Input min="0" type="number" step="0.25" value={actualHours} onChange={(event) => setActualHours(Number(event.target.value))} /></Field>{current.workers.map((worker) => { const member = data.team.find((item) => item.id === worker.memberId); return <Field key={worker.memberId} label={`Temps de ${member?.firstName ?? "collaborateur"} (h)`}><Input min="0" type="number" step="0.25" value={workerHours[worker.memberId] ?? 0} onChange={(event) => setWorkerHours((state) => ({ ...state, [worker.memberId]: Number(event.target.value) }))} /></Field>; })}<Field label="Produits (€)"><Input min="0" type="number" step="0.01" value={productEuros} onChange={(event) => setProductEuros(Number(event.target.value))} /></Field><Field label="Déplacement (€)"><Input min="0" type="number" step="0.01" value={travelEuros} onChange={(event) => setTravelEuros(Number(event.target.value))} /></Field><Field label="Autres coûts directs (€)"><Input min="0" type="number" step="0.01" value={otherEuros} onChange={(event) => setOtherEuros(Number(event.target.value))} /></Field></div><Button className="mt-4" onClick={() => { if (actualHours < 0 || productEuros < 0 || travelEuros < 0 || otherEuros < 0 || Object.values(workerHours).some((hours) => hours < 0)) { toast.error("Les durées et les coûts ne peuvent pas être négatifs"); return; } updateActuals(current.id, { actualDurationMinutes: Math.round(actualHours * 60), productCost: Math.round(productEuros * 100), travelCost: Math.round(travelEuros * 100), otherDirectCosts: Math.round(otherEuros * 100), workerMinutes: Object.fromEntries(Object.entries(workerHours).map(([id, hours]) => [id, Math.round(hours * 60)])) }); toast.success("Prestation terminée et rentabilité recalculée"); close(); }}><Square className="size-3.5" /> Terminer la prestation</Button></section> : null}
      <div className="flex flex-wrap gap-2">
        {current.status === "confirmed" || current.status === "scheduled" ? <Button onClick={() => { setStatus(current.id, "in_progress"); toast.success("Chronomètre démarré"); }}><Play className="size-4" /> Démarrer</Button> : null}
        <a href={`tel:${client?.phone}`}><Button variant="secondary"><PhoneIcon /></Button></a>
        <a target="_blank" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(current.address)}`}><Button variant="secondary"><MapPin className="size-4" /> Itinéraire</Button></a>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            const selectedPhotos = Array.from(event.target.files ?? []).map((file) => ({ name: file.name, size: file.size }));
            if (selectedPhotos.length === 0) return;
            setPhotos((items) => [...items, ...selectedPhotos]);
            toast.success(`${selectedPhotos.length} photo(s) sélectionnée(s)`);
            event.target.value = "";
          }}
        />
        <Button variant="secondary" onClick={() => photoInputRef.current?.click()}><Camera className="size-4" /> Ajouter des photos</Button>
      </div>
      {photos.length > 0 && <section className="rounded-2xl border border-white/[0.07] bg-white/[0.018] p-4"><h3 className="text-sm font-bold">Photos sélectionnées</h3><div className="mt-3 flex flex-wrap gap-2">{photos.map((photo, index) => <Badge key={`${photo.name}-${index}`}>{photo.name} · {Math.max(1, Math.round(photo.size / 1024))} Ko</Badge>)}</div><p className="mt-3 text-[11px] text-zinc-600">En mode démonstration, cette sélection reste locale à la fiche ouverte. Le schéma Supabase prévoit un bucket privé « intervention-photos » pour la persistance.</p></section>}
    </div>
  );
}

function PhoneIcon() {
  return <><span className="sr-only">Appeler</span><span aria-hidden>Appeler le client</span></>;
}

export default function PrestationsPage() {
  const data = useDemoStore();
  const [status, setStatus] = useState<"all" | InterventionStatus>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Intervention | null>(null);
  const filtered = useMemo(() => data.interventions.filter((item) => {
    const client = data.clients.find((entry) => entry.id === item.clientId);
    const vehicle = data.vehicles.find((entry) => entry.id === item.vehicleId);
    return (status === "all" || item.status === status) && normalizeText(`${item.title} ${client?.firstName} ${client?.lastName} ${client?.company ?? ""} ${vehicle?.registration}`).includes(normalizeText(query));
  }), [data.clients, data.interventions, data.vehicles, query, status]);
  const completed = data.interventions.filter((item) => item.status === "completed");
  const averageHourly = completed.length ? completed.reduce((sum, item) => sum + (hourlyMargin(item) ?? 0), 0) / completed.length : 0;
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Opérations" title="Prestations & rentabilité" description="Préparez, réalisez et mesurez chaque intervention, y compris les heures-personnes de chaque collaborateur." />
      <section className="grid gap-3 sm:grid-cols-3">{[
        { icon: Clock3, label: "À planifier", value: data.interventions.filter((item) => item.status === "to_schedule").length, detail: "à placer dans le planning" },
        { icon: UsersRound, label: "Heures-personnes", value: `${Math.round(data.interventions.reduce((sum, item) => sum + actualPersonMinutes(item), 0) / 60 * 10) / 10} h`, detail: "planifiées ou réalisées" },
        { icon: TimerReset, label: "Marge horaire moy.", value: `${formatMoney(averageHourly)}/h`, detail: `objectif ${formatMoney(data.settings.hourlyMarginTarget)}/h` },
      ].map((metric) => <Card key={metric.label}><CardContent className="flex items-center gap-4 p-5"><span className="grid size-10 place-items-center rounded-xl bg-brand-500/10 text-brand-400"><metric.icon className="size-5" /></span><div><p className="text-xs text-zinc-500">{metric.label}</p><p className="mt-1 text-xl font-bold">{metric.value}</p><p className="mt-1 text-[10px] text-zinc-600">{metric.detail}</p></div></CardContent></Card>)}</section>
      <div className="flex flex-col gap-3 sm:flex-row"><div className="relative max-w-sm flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-600" /><Input className="pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Client, véhicule, immatriculation…" /></div><Select className="sm:w-48" value={status} onChange={(event) => setStatus(event.target.value as "all" | InterventionStatus)}><option value="all">Tous les statuts</option>{Object.entries(interventionStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></div>
      <div className="grid gap-3">{filtered.map((item) => { const client = data.clients.find((entry) => entry.id === item.clientId); const vehicle = data.vehicles.find((entry) => entry.id === item.vehicleId); const margin = grossMargin(item); const hourly = hourlyMargin(item); const lowMargin = hourly !== null && hourly < data.settings.hourlyMarginTarget; return <button key={item.id} onClick={() => setSelected(item)} className="focus-ring grid gap-4 rounded-2xl border border-white/[0.07] bg-ink-850 p-4 text-left transition hover:-translate-y-0.5 hover:border-white/[0.13] sm:grid-cols-[minmax(220px,1.3fr)_150px_150px_130px_auto] sm:items-center sm:p-5"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-bold">{item.title}</p>{lowMargin && <AlertTriangle className="size-4 shrink-0 text-amber-300" />}</div><p className="mt-1 truncate text-xs text-zinc-500">{client?.company || `${client?.firstName} ${client?.lastName}`} · {vehicle?.registration}</p></div><div><p className="text-[10px] font-bold tracking-wider text-zinc-600 uppercase">Créneau</p><p className="mt-1 text-xs font-semibold">{formatDate(item.startAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p></div><div><p className="text-[10px] font-bold tracking-wider text-zinc-600 uppercase">Marge brute</p><p className="mt-1 text-sm font-bold text-emerald-300">{formatMoney(margin)}</p></div><div><p className="text-[10px] font-bold tracking-wider text-zinc-600 uppercase">Marge horaire</p><p className={`mt-1 text-sm font-bold ${lowMargin ? "text-amber-200" : "text-white"}`}>{hourly === null ? "—" : `${formatMoney(hourly)}/h`}</p></div><StatusBadge status={item.status}>{interventionStatusLabels[item.status]}</StatusBadge></button>; })}</div>
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title ?? "Prestation"} description="Fiche opérationnelle" className="sm:max-w-3xl">{selected && <InterventionDetail intervention={selected} close={() => setSelected(null)} />}</Modal>
    </div>
  );
}
