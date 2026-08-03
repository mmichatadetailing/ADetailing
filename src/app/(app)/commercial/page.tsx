"use client";

import { DndContext, type DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CalendarClock, GripVertical, LayoutGrid, List, Phone, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { leadStageLabels } from "@/lib/domain/labels";
import type { Lead, LeadStage } from "@/lib/domain/types";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney, normalizeText } from "@/lib/utils";

const stages: LeadStage[] = ["received", "qualify", "quote_to_prepare", "quote_sent", "follow_up", "won", "lost"];

function actionIsDue(value?: string) {
  if (!value) return false;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return new Date(value) <= endOfToday;
}

function LeadCard({ lead }: { lead: Lead }) {
  const team = useDemoStore((state) => state.team);
  const owner = team.find((member) => member.id === lead.ownerId);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id, data: { lead } });
  return (
    <article ref={setNodeRef} style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }} className={`rounded-2xl border border-white/[0.075] bg-ink-850 p-3.5 shadow-lg transition ${isDragging ? "z-50 opacity-70 shadow-2xl" : "hover:border-white/[0.13]"}`}>
      <div className="flex items-start gap-2"><button className="focus-ring -ml-1 cursor-grab rounded-lg p-1 text-zinc-700 hover:text-zinc-400 active:cursor-grabbing" {...listeners} {...attributes} aria-label="Déplacer la demande"><GripVertical className="size-4" /></button><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{lead.prospectName}</p><p className="mt-1 truncate text-xs text-zinc-500">{lead.vehicleLabel}</p></div></div>
      <div className="mt-4"><p className="truncate text-xs font-medium text-zinc-300">{lead.serviceLabel}</p><p className="mt-1 text-sm font-bold text-zinc-200">{formatMoney(lead.estimatedAmount)}</p></div>
      <div className="mt-4 flex flex-wrap gap-1.5"><Badge>{lead.source}</Badge><Badge variant={actionIsDue(lead.nextActionAt) ? "orange" : "neutral"}>{lead.nextAction}</Badge></div>
      <div className="mt-4 flex items-center justify-between border-t border-black/[0.06] pt-3"><div className="flex items-center gap-2"><Avatar label={owner?.initials ?? "?"} color={owner?.color} size="sm" /><span className="text-[10px] text-zinc-600">{formatDate(lead.requestedAt)}</span></div><a className="focus-ring grid size-7 place-items-center rounded-lg text-zinc-600 hover:bg-brand-50 hover:text-brand-600" href={`tel:${lead.phone}`}><Phone className="size-3.5" /></a></div>
    </article>
  );
}

function Column({ stage, leads }: { stage: LeadStage; leads: Lead[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section ref={setNodeRef} className={`w-[285px] shrink-0 rounded-2xl border p-2.5 transition ${isOver ? "border-brand-400/40 bg-brand-400/[0.045]" : "border-white/[0.055] bg-white/[0.018]"}`}>
      <header className="flex h-11 items-center justify-between px-2"><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${stage === "won" ? "bg-emerald-400" : stage === "lost" ? "bg-red-400" : stage === "follow_up" ? "bg-orange-400" : "bg-zinc-600"}`} /><h2 className="text-xs font-bold">{leadStageLabels[stage]}</h2></div><Badge>{leads.length}</Badge></header>
      <div className="grid min-h-24 gap-2.5">{leads.map((lead) => <LeadCard key={lead.id} lead={lead} />)}</div>
    </section>
  );
}

export default function CommercialPage() {
  const leads = useDemoStore((state) => state.leads);
  const moveLead = useDemoStore((state) => state.moveLead);
  const team = useDemoStore((state) => state.team);
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [query, setQuery] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const filtered = useMemo(() => leads.filter((lead) => normalizeText(`${lead.prospectName} ${lead.vehicleLabel} ${lead.serviceLabel}`).includes(normalizeText(query))), [leads, query]);
  const pipeline = filtered.reduce((sum, lead) => lead.stage !== "lost" ? sum + lead.estimatedAmount : sum, 0);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const target = stages.find((stage) => stage === over.id);
    if (target) moveLead(String(active.id), target);
  };
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Pipeline commercial" title="Transformer les demandes en prestations" description="Glissez les opportunités au fil des échanges. Les devis officiels restent créés dans Henrri." actions={<div className="flex rounded-xl border border-white/[0.07] bg-white/[0.025] p-1"><Button size="sm" variant={view === "kanban" ? "secondary" : "ghost"} onClick={() => setView("kanban")}><LayoutGrid className="size-3.5" /> Kanban</Button><Button size="sm" variant={view === "table" ? "secondary" : "ghost"} onClick={() => setView("table")}><List className="size-3.5" /> Tableau</Button></div>} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,auto)] sm:items-center"><div className="relative max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-600" /><Input className="pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une opportunité…" /></div><Badge>{filtered.length} opportunités</Badge><Badge variant="orange">Pipeline {formatMoney(pipeline)}</Badge><Badge variant="green">{leads.filter((lead) => lead.stage === "won").length} gagnée(s)</Badge></div>
      {view === "kanban" ? <DndContext sensors={sensors} onDragEnd={onDragEnd}><div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"><div className="flex w-max gap-3">{stages.map((stage) => <Column key={stage} stage={stage} leads={filtered.filter((lead) => lead.stage === stage)} />)}</div></div></DndContext> : <div className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-ink-850"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-white/[0.025] text-[10px] tracking-wider text-zinc-600 uppercase"><tr>{["Client", "Véhicule", "Prestation", "Montant", "Source", "Statut", "Responsable", "Prochaine action"].map((head) => <th key={head} className="px-4 py-3 font-semibold">{head}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.055]">{filtered.map((lead) => { const owner = team.find((member) => member.id === lead.ownerId); return <tr key={lead.id} className="hover:bg-white/[0.02]"><td className="px-4 py-4 font-semibold">{lead.prospectName}</td><td className="px-4 py-4 text-zinc-500">{lead.vehicleLabel}</td><td className="px-4 py-4">{lead.serviceLabel}</td><td className="px-4 py-4 font-semibold">{formatMoney(lead.estimatedAmount)}</td><td className="px-4 py-4"><Badge>{lead.source}</Badge></td><td className="px-4 py-4"><StatusBadge status={lead.stage}>{leadStageLabels[lead.stage]}</StatusBadge></td><td className="px-4 py-4"><div className="flex items-center gap-2"><Avatar label={owner?.initials ?? "?"} color={owner?.color} size="sm" />{owner?.firstName}</div></td><td className="px-4 py-4 text-zinc-500"><CalendarClock className="mr-1.5 inline size-3.5" />{lead.nextAction}</td></tr>; })}</tbody></table></div>}
    </div>
  );
}
