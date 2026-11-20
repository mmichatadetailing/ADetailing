"use client";

import { AlertTriangle, Banknote, CalendarPlus2, CircleDollarSign, Clock3, Pencil, Search, Sparkles, Trash2 } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { FinanceState } from "@/components/banking/finance-state";
import { InterventionDetail } from "@/components/intervention-detail";
import { useWorkspace } from "@/components/workspace-provider";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { getInterventionWorkflow } from "@/lib/domain/intervention-workflow";
import { collectedInterventionRevenue } from "@/lib/domain/calculations";
import { interventionStatusLabels } from "@/lib/domain/labels";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney, normalizeText } from "@/lib/utils";

type WorkflowFilter = "all" | "upcoming" | "in_progress" | "to_collect" | "qonto" | "done" | "cancelled";

const filterLabels: Record<WorkflowFilter, string> = {
  all: "Toutes les prestations",
  upcoming: "À venir",
  in_progress: "En cours",
  to_collect: "À encaisser",
  done: "Terminées et encaissées",
  qonto: "Avec paiement Qonto",
  cancelled: "Annulées",
};

function PrestationsPageContent() {
  const data = useDemoStore();
  const { mode, workspace } = useWorkspace();
  const canManage = mode === "demo" || Boolean(workspace?.canManageBusiness);
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryInterventionId = searchParams.get("intervention");
  const queryEdit = searchParams.get("edit") === "1";
  const [filter, setFilter] = useState<WorkflowFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedOverride, setSelectedOverride] = useState<string | null>(null);
  const [editOverride, setEditOverride] = useState(false);
  const [dismissedQueryId, setDismissedQueryId] = useState<string | null>(null);
  const [deletingInterventionId, setDeletingInterventionId] = useState<string | null>(null);
  const selectedQueryId = queryInterventionId === dismissedQueryId ? null : queryInterventionId;
  const selectedId = selectedOverride ?? selectedQueryId;
  const editOnOpen = selectedOverride ? editOverride : queryEdit;

  const rows = useMemo(() => data.interventions.map((intervention) => {
    const invoice = data.invoices.find((item) => item.id === intervention.invoiceId);
    return { intervention, invoice, workflow: getInterventionWorkflow(intervention, invoice, data.payments) };
  }), [data.interventions, data.invoices, data.payments]);

  const filtered = useMemo(() => rows.filter(({ intervention, workflow }) => {
    const client = data.clients.find((item) => item.id === intervention.clientId);
    const vehicle = data.vehicles.find((item) => item.id === intervention.vehicleId);
    const matchesQuery = normalizeText(`${intervention.title} ${client?.firstName} ${client?.lastName} ${client?.company ?? ""} ${vehicle?.make} ${vehicle?.model} ${vehicle?.registration} ${intervention.vehicleFormat ?? ""}`).includes(normalizeText(query));
    if (!matchesQuery) return false;
    if (filter === "upcoming") return ["to_schedule", "scheduled", "confirmed"].includes(intervention.status);
    if (filter === "in_progress") return intervention.status === "in_progress";
    if (filter === "to_collect") return intervention.status === "completed" && workflow.outstanding > 0;
    if (filter === "done") return intervention.status === "completed" && workflow.isPaid;
    if (filter === "qonto") return workflow.bankLinked;
    if (filter === "cancelled") return intervention.status === "cancelled";
    return true;
  }).sort((a, b) => {
    const first = a.intervention.startAt ?? "9999";
    const second = b.intervention.startAt ?? "9999";
    return first.localeCompare(second);
  }), [data.clients, data.vehicles, filter, query, rows]);

  const toCollectRows = rows.filter(({ intervention, workflow }) => intervention.status === "completed" && workflow.outstanding > 0);
  const toCollect = toCollectRows.reduce((sum, { workflow }) => sum + workflow.outstanding, 0);
  const collected = collectedInterventionRevenue(
    data.interventions.filter((intervention) => intervention.status !== "cancelled"),
    data.payments,
  );
  const inProgress = rows.filter(({ intervention }) => intervention.status === "in_progress").length;
  const selected = data.interventions.find((item) => item.id === selectedId);
  const deletingIntervention = data.interventions.find((item) => item.id === deletingInterventionId);
  const deletingClient = deletingIntervention ? data.clients.find((client) => client.id === deletingIntervention.clientId) : undefined;
  const deletingInvoice = deletingIntervention ? data.invoices.find((invoice) => invoice.id === deletingIntervention.invoiceId) : undefined;
  const deletingPayments = deletingIntervention ? data.payments.filter((payment) => payment.interventionId === deletingIntervention.id) : [];

  const removeIntervention = () => {
    if (!canManage || !deletingIntervention || getInterventionWorkflow(deletingIntervention, deletingInvoice, data.payments).bankLinked) return;
    data.removeIntervention(deletingIntervention.id);
    if (selectedId === deletingIntervention.id) {
      setSelectedOverride(null);
      setEditOverride(false);
      setDismissedQueryId(queryInterventionId);
      router.replace("/prestations", { scroll: false });
    }
    setDeletingInterventionId(null);
    toast.success("Prestation supprimée", { description: deletingInvoice ? "La facture liée a été conservée." : "Elle a été retirée du planning et des statistiques." });
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Du rendez-vous à l’encaissement"
        title="Prestations"
        description="Retrouvez le rendez-vous et son règlement dans le même dossier. Un paiement lié à Qonto est déjà enregistré ; les visites d’entretien sont réglées au niveau du contrat."
        actions={<Button onClick={() => window.dispatchEvent(new CustomEvent("adetailing:open-add", { detail: "appointment" }))}><CalendarPlus2 className="size-4" /> Ajouter une prestation</Button>}
      />

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: Sparkles, label: "En cours", value: String(inProgress), detail: "à terminer", tone: "bg-sky-100 text-sky-700" },
          { icon: CircleDollarSign, label: "À encaisser", value: formatMoney(toCollect), detail: `${toCollectRows.length} prestation(s) terminée(s)`, tone: "bg-violet-100 text-violet-700" },
          { icon: Banknote, label: "Déjà encaissé", value: formatMoney(collected), detail: "prestations et entretiens", tone: "bg-emerald-100 text-emerald-700" },
        ].map((metric) => <Card key={metric.label}><CardContent className="flex items-center gap-4 p-5"><span className={`grid size-10 place-items-center rounded-xl ${metric.tone}`}><metric.icon className="size-5" /></span><div><p className="text-xs text-zinc-500">{metric.label}</p><p className="mt-1 text-xl font-bold">{metric.value}</p><p className="mt-1 text-[10px] text-zinc-500">{metric.detail}</p></div></CardContent></Card>)}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative max-w-md flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" /><Input type="search" aria-label="Rechercher une prestation" className="pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Client, véhicule, immatriculation, prestation…" /></div>
        <Select aria-label="Filtrer les prestations" className="sm:w-56" value={filter} onChange={(event) => setFilter(event.target.value as WorkflowFilter)}>{Object.entries(filterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
      </div>

      <div className="grid gap-3">
        {filtered.length === 0 && <div className="rounded-2xl border border-dashed border-line bg-zinc-50 p-10 text-center"><p className="text-sm font-bold">Aucune prestation dans cette vue</p><p className="mt-2 text-xs text-zinc-500">Modifiez le filtre ou ajoutez une prestation.</p></div>}
        {filtered.map(({ intervention, workflow }) => {
          const client = data.clients.find((item) => item.id === intervention.clientId);
          const vehicle = data.vehicles.find((item) => item.id === intervention.vehicleId);
          const vehicleSummary = vehicle ? `${vehicle.make} ${vehicle.model}${vehicle.registration ? ` · ${vehicle.registration}` : ""}` : intervention.vehicleFormat || "Véhicule non renseigné";
          return (
            <div key={intervention.id} className="surface-interactive grid grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-contrast/[0.08] bg-ink-900 text-content shadow-[0_6px_22px_rgba(47,40,72,.06)]">
              <button onClick={() => { setEditOverride(false); setSelectedOverride(intervention.id); }} className="focus-ring grid min-w-0 gap-3 p-4 text-left hover:bg-brand-50/40 md:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(8rem,.75fr)_minmax(10rem,1fr)] xl:items-center">
                <div className="min-w-0"><p className="break-words text-base font-bold">{intervention.title}</p><p className="mt-1 break-words text-sm text-zinc-600">{client?.company || [client?.firstName,client?.lastName].filter(Boolean).join(" ") || "Client non renseigné"} · {vehicleSummary}</p><div className="mt-2"><StatusBadge status={intervention.status}>{interventionStatusLabels[intervention.status]}</StatusBadge></div></div>
                <div><p className="text-xs font-semibold text-zinc-500">Rendez-vous</p><p className="mt-1 text-sm font-semibold">{intervention.startAt ? formatDate(intervention.startAt, {day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) : "Sans créneau"}</p><p className="mt-1 text-xs text-zinc-500"><Clock3 className="mr-1 inline size-3" />{intervention.plannedDurationMinutes / 60} h prévues</p></div>
                <div className="min-w-0"><FinanceState {...workflow.paymentState} /><p className="mt-1 text-sm font-bold tabular-nums">{intervention.maintenanceContractId ? "0 € à encaisser sur la visite" : formatMoney(workflow.payableTotal)}</p>
                  {workflow.paidAmount > 0 && workflow.outstanding > 0 && <p className="text-xs text-zinc-600">{formatMoney(workflow.outstanding)} restant</p>}</div>
              </button>
              {canManage && <div className="m-2 flex flex-col items-center gap-1 self-start lg:m-3 lg:flex-row lg:self-center">
                <button type="button" onClick={() => { setEditOverride(true); setSelectedOverride(intervention.id); }} aria-label={`Modifier ${intervention.title}`} title="Modifier" className="focus-ring grid size-11 place-items-center rounded-xl border border-contrast/[0.08] bg-zinc-50 text-zinc-500 shadow-sm transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"><Pencil className="size-4" /></button>
                {!workflow.bankLinked && <button type="button" onClick={() => setDeletingInterventionId(intervention.id)} aria-label={`Supprimer ${intervention.title}`} title="Supprimer la prestation" className="focus-ring grid size-11 place-items-center rounded-xl border border-red-100 bg-red-50 text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-100"><Trash2 className="size-4" /></button>}
              </div>}
            </div>
          );
        })}
      </div>

      <Modal open={Boolean(deletingIntervention)} onClose={() => setDeletingInterventionId(null)} title="Supprimer cette prestation ?" description={deletingIntervention?.title}>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
          <p className="flex items-center gap-2 text-sm font-bold"><AlertTriangle className="size-4" /> La prestation disparaîtra du planning et des statistiques</p>
          <p className="mt-2 text-xs leading-5 text-red-800">Cette action retire également ses paiements manuels. Elle ne supprime jamais une facture Henrri déjà liée ni les éléments d’historique nécessaires.</p>
        </div>
        {deletingIntervention && <div className="mt-4 rounded-2xl border border-line bg-zinc-50 p-4"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-bold text-zinc-900">{deletingClient?.company || `${deletingClient?.firstName ?? ""} ${deletingClient?.lastName ?? ""}`.trim() || "Client non renseigné"}</p><p className="mt-1 text-xs text-zinc-500">{deletingIntervention.startAt ? formatDate(deletingIntervention.startAt, { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Sans date"}</p></div>{deletingIntervention.maintenanceContractId ? <p className="text-sm font-extrabold text-emerald-700">Incluse dans le forfait</p> : <p className="text-base font-extrabold text-zinc-900">{formatMoney(deletingIntervention.items.reduce((sum, item) => sum + item.revenueAllocated, 0))}</p>}</div><div className="mt-3 flex flex-wrap gap-2">{deletingInvoice && <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700">Facture {deletingInvoice.number} conservée</span>}{deletingPayments.length > 0 && <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700">{deletingPayments.length} paiement(s) manuel(s) supprimé(s)</span>}</div></div>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeletingInterventionId(null)}>Annuler</Button><Button variant="danger" onClick={removeIntervention}><Trash2 className="size-4" /> Supprimer la prestation</Button></div>
      </Modal>

      <Modal open={Boolean(selectedId)} onClose={() => { setSelectedOverride(null); setEditOverride(false); setDismissedQueryId(queryInterventionId); router.replace("/prestations", { scroll: false }); }} title={selected?.title ?? "Dossier prestation"} description="Rendez-vous · réalisation · encaissement · justificatif facultatif" className="sm:max-w-5xl">
        {selectedId && <InterventionDetail key={`${selectedId}-${editOnOpen ? "edit" : "view"}`} interventionId={selectedId} startEditing={editOnOpen} />}
      </Modal>
    </div>
  );
}

export default function PrestationsPage() {
  return <Suspense fallback={<div className="grid min-h-64 place-items-center text-sm text-zinc-500">Chargement des prestations…</div>}><PrestationsPageContent /></Suspense>;
}
