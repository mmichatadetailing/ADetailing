"use client";

import { AlertTriangle, CalendarDays, CalendarPlus2, ChevronDown, ChevronLeft, ChevronRight, HelpCircle, Link2, LoaderCircle, Plus, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { interventionStatusLabels } from "@/lib/domain/labels";
import type { InterventionStatus, TeamMember } from "@/lib/domain/types";
import { cn, formatDate } from "@/lib/utils";

type CalendarView = "timeline" | "day" | "week" | "month";
type SourceFilter = "all" | "adetailing" | "planning" | "google";
type StatusFilter = "all" | InterventionStatus;

const views: Array<{ id: CalendarView; label: string }> = [
  { id: "timeline", label: "Timeline" }, { id: "day", label: "Jour" },
  { id: "week", label: "Semaine" }, { id: "month", label: "Mois" },
];
const sources: Record<SourceFilter, string> = {
  all: "Toutes les sources", adetailing: "Prestations", planning: "Événements internes", google: "Google Calendar",
};
const statuses: InterventionStatus[] = ["scheduled", "confirmed", "in_progress", "completed"];

export function PlanningToolbar({
  title, view, onNavigate, onToday, onChooseDate, onChangeView, onAdd,
  teamPlanning, members, memberFilter, sourceFilter, statusFilter,
  onMemberChange, onSourceChange, onStatusChange, onResetFilters,
  googleEnabled, googleConnected, googleLoading, googleError, googleCount, googleSyncedAt, onSync,
  conflictCount, onConflict, unscheduledCount, unscheduledExpanded, onUnscheduled,
}: {
  title: string;
  view: CalendarView;
  onNavigate: (direction: -1 | 1) => void;
  onToday: () => void;
  onChooseDate: () => void;
  onChangeView: (view: CalendarView) => void;
  onAdd: () => void;
  teamPlanning: boolean;
  members: TeamMember[];
  memberFilter: string;
  sourceFilter: SourceFilter;
  statusFilter: StatusFilter;
  onMemberChange: (id: string) => void;
  onSourceChange: (source: SourceFilter) => void;
  onStatusChange: (status: StatusFilter) => void;
  onResetFilters: () => void;
  googleEnabled: boolean;
  googleConnected: boolean;
  googleLoading: boolean;
  googleError: string;
  googleCount: number;
  googleSyncedAt: string | null;
  onSync: () => void;
  conflictCount: number;
  onConflict: () => void;
  unscheduledCount: number;
  unscheduledExpanded: boolean;
  onUnscheduled: () => void;
}) {
  const [panel, setPanel] = useState<"filters" | "help" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLButtonElement>(null);
  const helpRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const statusEnabled = sourceFilter === "all" || sourceFilter === "adetailing";
  const activeFilters = [
    teamPlanning && memberFilter !== "all" ? (members.find((member) => member.id === memberFilter)?.firstName ?? "Collaborateur") : null,
    sourceFilter !== "all" ? sources[sourceFilter] : null,
    statusEnabled && statusFilter !== "all" ? interventionStatusLabels[statusFilter] : null,
  ].filter(Boolean);

  useEffect(() => {
    if (!panel) return;
    const trigger = panel === "filters" ? filtersRef.current : helpRef.current;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setPanel(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPanel(null);
        trigger?.focus();
      }
    };
    const frame = requestAnimationFrame(() => {
      const firstControl = panelRef.current?.querySelector<HTMLElement>("select") ?? panelRef.current?.querySelector<HTMLElement>("button:not(:disabled)");
      firstControl?.focus();
    });
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [panel]);

  const closePanel = () => {
    (panel === "filters" ? filtersRef.current : helpRef.current)?.focus();
    setPanel(null);
  };

  return (
    <div
      ref={containerRef}
      className="planning-toolbar sticky top-[var(--app-header-height)] z-20 rounded-2xl border border-black/[.08] bg-white/95 shadow-[0_8px_28px_rgba(78,64,120,.09)] backdrop-blur-xl"
      data-planning-controls
      onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setPanel(null); }}
    >
      <nav aria-label="Navigation du planning" className="planning-toolbar-main">
        <div className="planning-toolbar-quick-actions">
        <div className="planning-toolbar-navigation flex shrink-0 items-center rounded-xl border border-black/[.08] bg-slate-50/80 p-0.5">
          <Button variant="ghost" size="icon" className="size-9 min-h-9 sm:size-10" aria-label="Période précédente" title="Période précédente (←)" onClick={() => { setPanel(null); onNavigate(-1); }}><ChevronLeft className="size-4" /></Button>
          <Button variant="ghost" size="sm" className="min-h-9 px-2 sm:min-h-10" title="Aujourd’hui (T)" onClick={() => { setPanel(null); onToday(); }}>Aujourd’hui</Button>
          <Button variant="ghost" size="icon" className="size-9 min-h-9 sm:size-10" aria-label="Période suivante" title="Période suivante (→)" onClick={() => { setPanel(null); onNavigate(1); }}><ChevronRight className="size-4" /></Button>
        </div>

        <Button ref={filtersRef} variant="secondary" className={cn("planning-toolbar-filters min-h-10 shrink-0 gap-1.5 px-2.5 shadow-none", (panel === "filters" || activeFilters.length > 0) && "border-brand-400/40 bg-brand-50 text-brand-600")} aria-label={`Filtres${activeFilters.length ? ` : ${activeFilters.length} actif(s)` : ""}`} aria-expanded={panel === "filters"} aria-controls={panel === "filters" ? panelId : undefined} title="Filtrer le planning" onClick={() => setPanel((current) => current === "filters" ? null : "filters")}>
          <SlidersHorizontal className="size-4" /><span className="planning-toolbar-filter-label">Filtres</span>
          {activeFilters.length > 0 && <span className="planning-toolbar-filter-count grid size-4 place-items-center rounded-full bg-brand-600 text-[10px] text-white">{activeFilters.length}</span>}
        </Button>
        <Button className="planning-toolbar-add min-h-10 shrink-0 gap-1.5 px-3 text-xs" aria-label="Ajouter un événement" title="Ajouter un événement" onClick={() => { setPanel(null); onAdd(); }}><Plus className="size-4" /><span className="planning-toolbar-add-label">Ajouter</span></Button>
        </div>

        <div className="planning-toolbar-calendar-controls">
        <button
          type="button"
          className="planning-toolbar-date focus-ring flex min-h-10 min-w-0 items-center gap-2 rounded-xl px-1 text-left font-bold text-slate-900 hover:bg-brand-50 sm:px-2"
          aria-label={`Choisir une date : ${title}`}
          aria-haspopup="dialog"
          title={title}
          onClick={() => { setPanel(null); onChooseDate(); }}
        >
          <CalendarDays className="hidden size-4 shrink-0 text-brand-600 sm:block" />
          <span className="min-w-0 truncate text-sm capitalize">{title}</span>
          <ChevronDown className="size-3.5 shrink-0 text-slate-500" />
        </button>

        <div className="planning-toolbar-views shrink-0">
          <div className="planning-toolbar-view-buttons items-center gap-0.5 rounded-xl border border-black/[.08] bg-slate-50/80 p-0.5" role="group" aria-label="Vue du planning">
            {views.map((entry) => <Button key={entry.id} size="sm" variant="ghost" aria-pressed={view === entry.id} className={cn("min-h-10 px-3", view === entry.id && "bg-white text-brand-600 shadow-sm ring-1 ring-black/5")} onClick={() => { setPanel(null); onChangeView(entry.id); }}>{entry.label}</Button>)}
          </div>
          <Select aria-label="Vue du planning" className="planning-toolbar-view-select min-h-10 w-[106px] rounded-xl py-1 text-xs shadow-none" value={view} onChange={(event) => { setPanel(null); onChangeView(event.target.value as CalendarView); }}>
            {views.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </Select>
        </div>
        </div>
      </nav>

      <div className="flex min-h-9 items-center gap-2 border-t border-black/[.05] px-2.5 py-1 text-[11px] text-slate-600 sm:px-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          {activeFilters.length > 0 ? (
            <button type="button" className="focus-ring inline-flex max-w-full items-center gap-1 rounded-md text-brand-600 hover:underline" onClick={onResetFilters} title={`Effacer les filtres : ${activeFilters.join(", ")}`} aria-label="Effacer tous les filtres"><span className="max-w-[180px] truncate sm:max-w-[280px]">{activeFilters.join(" · ")}</span><X className="size-3 shrink-0" /></button>
          ) : <span>{teamPlanning ? "Toute l’équipe" : "Mon planning"}</span>}
          {googleEnabled && (
            googleConnected || googleLoading || googleError ? (
              <button type="button" disabled={googleLoading} className={cn("focus-ring inline-flex min-h-7 items-center gap-1.5 rounded-md px-1 hover:bg-sky-50 hover:text-sky-800 disabled:cursor-wait", googleError ? "text-red-600" : "text-sky-700")} aria-label={googleError ? "Réessayer la synchronisation Google" : "Actualiser Google Calendar"} title={googleError || (googleSyncedAt ? `Dernière synchronisation à ${formatDate(googleSyncedAt, { hour: "2-digit", minute: "2-digit" })} · Cliquer pour actualiser` : "Actualiser Google Calendar")} onClick={onSync}>
                {googleLoading ? <LoaderCircle className="size-3 animate-spin" /> : googleError ? <AlertTriangle className="size-3" /> : <RefreshCw className="size-3" />}
                <span>{googleError ? "Google à vérifier" : googleLoading ? "Google…" : `Google · ${googleCount}`}</span>
              </button>
            ) : <Link href="/parametres#integrations" className="focus-ring inline-flex min-h-7 items-center gap-1 rounded-md px-1 text-sky-700 hover:bg-sky-50"><Link2 className="size-3" /> Connecter Google</Link>
          )}
          {conflictCount > 0 && <button type="button" className="focus-ring inline-flex min-h-7 items-center gap-1 rounded-md bg-red-50 px-2 font-semibold text-red-700 hover:bg-red-100" onClick={onConflict} title="Aller au premier conflit"><AlertTriangle className="size-3" /> {conflictCount} conflit(s)</button>}
          {unscheduledCount > 0 && <button type="button" className={cn("focus-ring inline-flex min-h-7 items-center gap-1 rounded-md px-1 text-amber-800 hover:bg-amber-50", unscheduledExpanded && "bg-amber-50")} onClick={onUnscheduled} aria-expanded={unscheduledExpanded} aria-controls="planning-unscheduled"><CalendarPlus2 className="size-3" /> {unscheduledCount} à planifier</button>}
        </div>
        <Button ref={helpRef} size="icon" variant="ghost" className="size-7 min-h-7 shrink-0" aria-label="Légende et raccourcis" title="Légende et raccourcis" aria-expanded={panel === "help"} aria-controls={panel === "help" ? panelId : undefined} onClick={() => setPanel((current) => current === "help" ? null : "help")}><HelpCircle className="size-4" /></Button>
      </div>

      {panel && <div ref={panelRef} id={panelId} role="region" aria-label={panel === "filters" ? "Filtres du planning" : "Aide du planning"} className="absolute right-0 left-0 top-[calc(100%+.5rem)] max-h-[calc(100dvh-var(--app-header-height)-210px)] overflow-y-auto rounded-2xl border border-black/10 bg-white p-4 shadow-[0_18px_48px_rgba(47,40,72,.18)] sm:left-auto sm:w-[380px]">
        {panel === "filters" ? <>
          <div className="mb-4 flex items-center justify-between gap-2"><h2 className="text-sm font-bold text-slate-900">Filtres du planning</h2><Button variant="ghost" size="sm" disabled={!activeFilters.length} onClick={onResetFilters}>Réinitialiser</Button></div>
          <div className="grid gap-3">
            {teamPlanning && <Field label="Collaborateur"><Select value={memberFilter} onChange={(event) => onMemberChange(event.target.value)}><option value="all">Toute l’équipe</option>{members.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}</Select></Field>}
            <Field label="Source"><Select value={sourceFilter} onChange={(event) => onSourceChange(event.target.value as SourceFilter)}>{Object.entries(sources).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select></Field>
            {statusEnabled && <Field label="Statut de la prestation"><Select value={statusFilter} onChange={(event) => onStatusChange(event.target.value as StatusFilter)}><option value="all">Tous les statuts</option>{statuses.map((status) => <option key={status} value={status}>{interventionStatusLabels[status]}</option>)}</Select></Field>}
          </div>
          <Button className="mt-4 w-full" variant="secondary" onClick={closePanel}>Terminé</Button>
        </> : <>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-slate-900">Légende et raccourcis</h2><Button variant="ghost" size="icon" className="size-8 min-h-8" aria-label="Fermer l’aide" onClick={closePanel}><X className="size-4" /></Button></div>
          <ul className="grid gap-2 text-xs text-slate-700">
            <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-brand-500" /> Prestations · couleur du collaborateur</li>
            <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-violet-500" /> Événements internes · couleur du type</li>
            <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-sky-500" /> Google Calendar</li>
            <li className="flex items-center gap-2"><span className="size-2.5 rounded-full ring-2 ring-red-500" /> Conflit de planning</li>
          </ul>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-black/[.06] pt-3 text-xs text-slate-600"><dt>← / →</dt><dd>Période précédente / suivante</dd><dt>T</dt><dd>Aujourd’hui</dd><dt>J / S / M / L</dt><dd>Jour / Semaine / Mois / Timeline</dd></dl>
        </>}
      </div>}
    </div>
  );
}
