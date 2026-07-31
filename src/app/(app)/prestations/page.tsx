"use client";

import { CalendarPlus2, CircleDollarSign, Clock3, ReceiptText, Search, Sparkles } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { InterventionDetail } from "@/components/intervention-detail";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { getInterventionWorkflow } from "@/lib/domain/intervention-workflow";
import { interventionStatusLabels } from "@/lib/domain/labels";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney, normalizeText } from "@/lib/utils";

type WorkflowFilter = "all" | "upcoming" | "in_progress" | "to_invoice" | "to_collect" | "done" | "cancelled";

const filterLabels: Record<WorkflowFilter, string> = {
  all: "Toutes les prestations",
  upcoming: "À venir",
  in_progress: "En cours",
  to_invoice: "À facturer",
  to_collect: "À encaisser",
  done: "Terminées & payées",
  cancelled: "Annulées",
};

function PrestationsPageContent() {
  const data = useDemoStore();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<WorkflowFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedOverride, setSelectedOverride] = useState<string | null | undefined>(undefined);
  const selectedId = selectedOverride === undefined ? searchParams.get("intervention") : selectedOverride;

  const rows = useMemo(() => data.interventions.map((intervention) => {
    const invoice = data.invoices.find((item) => item.id === intervention.invoiceId);
    return { intervention, invoice, workflow: getInterventionWorkflow(intervention, invoice, data.payments) };
  }), [data.interventions, data.invoices, data.payments]);

  const filtered = useMemo(() => rows.filter(({ intervention, invoice, workflow }) => {
    const client = data.clients.find((item) => item.id === intervention.clientId);
    const vehicle = data.vehicles.find((item) => item.id === intervention.vehicleId);
    const matchesQuery = normalizeText(`${intervention.title} ${client?.firstName} ${client?.lastName} ${client?.company ?? ""} ${vehicle?.make} ${vehicle?.model} ${vehicle?.registration}`).includes(normalizeText(query));
    if (!matchesQuery) return false;
    if (filter === "upcoming") return ["to_schedule", "scheduled", "confirmed"].includes(intervention.status);
    if (filter === "in_progress") return intervention.status === "in_progress";
    if (filter === "to_invoice") return intervention.status === "completed" && !invoice;
    if (filter === "to_collect") return Boolean(invoice) && !workflow.isComplete;
    if (filter === "done") return workflow.isComplete;
    if (filter === "cancelled") return intervention.status === "cancelled";
    return true;
  }).sort((a, b) => {
    const first = a.intervention.startAt ?? "9999";
    const second = b.intervention.startAt ?? "9999";
    return first.localeCompare(second);
  }), [data.clients, data.vehicles, filter, query, rows]);

  const toInvoice = rows.filter(({ intervention, invoice }) => intervention.status === "completed" && !invoice).length;
  const toCollect = rows.reduce((sum, { workflow }) => sum + workflow.outstanding, 0);
  const inProgress = rows.filter(({ intervention }) => intervention.status === "in_progress").length;
  const selected = data.interventions.find((item) => item.id === selectedId);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Du rendez-vous à l’encaissement"
        title="Prestations"
        description="Chaque dossier réunit le rendez-vous, l’exécution, la facture Henrri et le paiement. Ouvrez une ligne pour tout consulter ou modifier."
        actions={<Button onClick={() => window.dispatchEvent(new CustomEvent("adetailing:open-add", { detail: "appointment" }))}><CalendarPlus2 className="size-4" /> Nouveau rendez-vous</Button>}
      />

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: Sparkles, label: "En cours", value: String(inProgress), detail: "à terminer", tone: "bg-sky-100 text-sky-700" },
          { icon: ReceiptText, label: "À facturer", value: String(toInvoice), detail: "prestations terminées", tone: "bg-violet-100 text-violet-700" },
          { icon: CircleDollarSign, label: "À encaisser", value: formatMoney(toCollect), detail: "sur les factures liées", tone: "bg-emerald-100 text-emerald-700" },
        ].map((metric) => <Card key={metric.label}><CardContent className="flex items-center gap-4 p-5"><span className={`grid size-10 place-items-center rounded-xl ${metric.tone}`}><metric.icon className="size-5" /></span><div><p className="text-xs text-zinc-500">{metric.label}</p><p className="mt-1 text-xl font-bold">{metric.value}</p><p className="mt-1 text-[10px] text-zinc-500">{metric.detail}</p></div></CardContent></Card>)}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative max-w-md flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" /><Input className="pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Client, véhicule, immatriculation, prestation…" /></div>
        <Select className="sm:w-56" value={filter} onChange={(event) => setFilter(event.target.value as WorkflowFilter)}>{Object.entries(filterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
      </div>

      <div className="grid gap-3">
        {filtered.length === 0 && <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-10 text-center"><p className="text-sm font-bold">Aucune prestation dans cette vue</p><p className="mt-2 text-xs text-zinc-500">Modifiez le filtre ou créez un nouveau rendez-vous.</p></div>}
        {filtered.map(({ intervention, workflow }) => {
          const client = data.clients.find((item) => item.id === intervention.clientId);
          const vehicle = data.vehicles.find((item) => item.id === intervention.vehicleId);
          const currentStep = workflow.steps.find((step) => step.state === "current");
          return (
            <button key={intervention.id} onClick={() => setSelectedOverride(intervention.id)} className="focus-ring surface-interactive grid gap-4 rounded-2xl border border-zinc-200 bg-white p-4 text-left sm:grid-cols-[minmax(230px,1.3fr)_170px_150px_minmax(180px,.8fr)_auto] sm:items-center sm:p-5">
              <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-bold">{intervention.title}</p>{workflow.isComplete && <CheckMark />}</div><p className="mt-1 truncate text-xs text-zinc-500">{client?.company || `${client?.firstName} ${client?.lastName}`} · {vehicle?.make} {vehicle?.model} · {vehicle?.registration}</p><div className="mt-3 flex items-center gap-1.5">{workflow.steps.map((step) => <span key={step.id} title={`${step.label} : ${step.detail}`} className={`h-1.5 flex-1 rounded-full ${step.state === "done" ? "bg-emerald-500" : step.state === "current" ? "bg-brand-500" : "bg-zinc-200"}`} />)}</div></div>
              <div><p className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">Rendez-vous</p><p className="mt-1 text-xs font-semibold">{intervention.startAt ? formatDate(intervention.startAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "À planifier"}</p><p className="mt-1 text-[10px] text-zinc-500"><Clock3 className="mr-1 inline size-3" /> {intervention.plannedDurationMinutes / 60} h</p></div>
              <div><p className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">Montant prévu</p><p className="mt-1 text-sm font-bold">{formatMoney(intervention.items.reduce((sum, item) => sum + item.revenueAllocated, 0))}</p></div>
              <div><p className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">Prochaine étape</p><p className={`mt-1 text-xs font-bold ${workflow.isComplete ? "text-emerald-700" : "text-brand-700"}`}>{workflow.isComplete ? "Parcours terminé" : intervention.status === "cancelled" ? "Prestation annulée" : currentStep?.detail}</p></div>
              <StatusBadge status={intervention.status}>{interventionStatusLabels[intervention.status]}</StatusBadge>
            </button>
          );
        })}
      </div>

      <Modal open={Boolean(selectedId)} onClose={() => setSelectedOverride(null)} title={selected?.title ?? "Dossier prestation"} description="Rendez-vous · réalisation · facture · paiement" className="sm:max-w-5xl">
        {selectedId && <InterventionDetail key={selectedId} interventionId={selectedId} />}
      </Modal>
    </div>
  );
}

export default function PrestationsPage() {
  return <Suspense fallback={<div className="grid min-h-64 place-items-center text-sm text-zinc-500">Chargement des prestations…</div>}><PrestationsPageContent /></Suspense>;
}

function CheckMark() {
  return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-[10px] font-black text-emerald-700">✓</span>;
}
