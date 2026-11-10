"use client";

import Link from "next/link";
import { AlertCircle, FileText, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { financialDateKey } from "@/lib/domain/periods";
import { listQontoInvoices, qontoInvoiceDaysLate, qontoInvoiceMatchesFilter, qontoInvoiceStatus, qontoOverdueEuroTotal, type QontoInvoice, type QontoInvoiceFeed, type QontoInvoiceFilter, type QontoInvoiceOrder, type QontoInvoiceStatus } from "@/lib/domain/qonto-invoices";

const statusDetails = {
  overdue: { label: "En retard", variant: "red" }, unpaid: { label: "À encaisser", variant: "blue" }, paid: { label: "Payée", variant: "green" },
  draft: { label: "Brouillon", variant: "neutral" }, canceled: { label: "Annulée", variant: "neutral" }, unknown: { label: "À vérifier", variant: "yellow" },
} as const;
const filters: Array<[QontoInvoiceFilter, string]> = [["all", "Toutes"], ["overdue", "En retard"], ["unpaid", "À encaisser"], ["paid", "Payées"], ["draft", "Brouillons"], ["canceled", "Annulées"]];
const shortDate = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const refreshDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const dateLabel = (value: string | null) => value ? shortDate.format(new Date(`${value}T00:00:00Z`)) : "—";
function amountLabel(amount: string | null, currency: string | null) {
  if (amount === null || !currency || !Number.isFinite(Number(amount))) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(Number(amount));
}

function InvoiceDue({ invoice, status, today }: { invoice: QontoInvoice; status: QontoInvoiceStatus; today: string }) {
  const days = status === "overdue" && invoice.dueDate ? qontoInvoiceDaysLate(invoice.dueDate, today) : 0;
  return <><span className={days > 0 ? "font-semibold text-red-700" : "text-zinc-500"}>{dateLabel(invoice.dueDate)}</span>
    {days > 0 && <span className="mt-1 block text-xs font-semibold text-red-700">{days} jour{days > 1 ? "s" : ""} de retard</span>}
    {status === "unpaid" && invoice.dueDate === today && <span className="mt-1 block text-xs font-semibold text-amber-800">Aujourd’hui</span>}
  </>;
}

export function QontoInvoiceList({ invoices, today }: { invoices: QontoInvoice[]; today: string }) {
  const [filter, setFilter] = useState<QontoInvoiceFilter>("all");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<QontoInvoiceOrder>("priority");
  const [page, setPage] = useState(0);
  const counts = useMemo(() => {
    const results = { all: 0, overdue: 0, unpaid: 0, paid: 0, draft: 0, canceled: 0 };
    for (const invoice of invoices) {
      const status = qontoInvoiceStatus(invoice, today);
      for (const [key] of filters) if (qontoInvoiceMatchesFilter(status, key)) results[key]++;
    }
    return results;
  }, [invoices, today]);
  const overdueTotal = useMemo(() => qontoOverdueEuroTotal(invoices, today), [invoices, today]);
  const results = useMemo(() => listQontoInvoices(invoices, today, filter, query, order), [invoices, today, filter, query, order]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(results.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = results.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const selectFilter = (next: QontoInvoiceFilter) => { setFilter(next); setPage(0); };
  return <>
    <div className="grid gap-2 sm:grid-cols-3" aria-label="Synthèse des factures Qonto">
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
        <p className="text-xs font-semibold">En retard</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{amountLabel(overdueTotal.amount, "EUR")}</p>
        <p className="mt-1 text-xs">{overdueTotal.missing > 0 ? "Solde connu en euros" : "Reste à encaisser en euros"} · {counts.overdue} facture{counts.overdue === 1 ? "" : "s"}</p>
        {overdueTotal.missing > 0 && <p className="mt-1 text-xs">Solde non communiqué pour {overdueTotal.missing} facture{overdueTotal.missing === 1 ? "" : "s"} en euros.</p>}
        {overdueTotal.nonEuro > 0 && <p className="mt-1 text-xs">Les factures hors EUR ou sans devise renseignée ne sont pas incluses dans le montant.</p>}
      </div>
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-900"><p className="text-xs font-semibold">À encaisser · retards inclus</p><p className="mt-1 text-2xl font-bold tabular-nums">{counts.unpaid}</p></div>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"><p className="text-xs font-semibold">Payées</p><p className="mt-1 text-2xl font-bold tabular-nums">{counts.paid}</p></div>
    </div>
    <div className="mt-5 flex flex-wrap gap-2" aria-label="Filtrer les factures Qonto par statut">
      {filters.map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => selectFilter(key)} className={`focus-ring rounded-lg border px-3 py-2 text-xs font-semibold transition ${filter === key ? "border-brand-400/40 bg-brand-400/10 text-brand-600" : "border-black/10 bg-white text-zinc-500 hover:bg-zinc-50"}`}>{label} <span className="ml-0.5 tabular-nums">{counts[key]}</span></button>)}
    </div>
    <div className="my-4 flex flex-wrap items-center gap-3">
      <div className="relative min-w-48 flex-1"><Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" /><Input type="search" className="pl-9" aria-label="Rechercher une facture Qonto" placeholder="Client ou numéro de facture…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></div>
      <Select aria-label="Trier les factures Qonto" className="w-auto" value={order} onChange={(event) => { setOrder(event.target.value as QontoInvoiceOrder); setPage(0); }}><option value="priority">Retards d’abord</option><option value="due">Échéance la plus proche</option><option value="recent">Émission récente</option></Select>
    </div>
    {rows.length === 0 ? <div className="rounded-xl border border-dashed border-black/10 p-7 text-center text-sm text-zinc-500"><FileText aria-hidden="true" className="mx-auto mb-2 size-5" />{invoices.length === 0 ? "Aucune facture client trouvée dans Qonto." : filter === "overdue" && !query ? "Aucune facture en retard." : "Aucune facture ne correspond à ces critères."}</div> : <>
      <div className="hidden overflow-x-auto rounded-xl border border-black/10 md:block"><table className="w-full min-w-[680px] text-left text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500"><tr>{["Facture", "Client", "Émission", "Échéance", "Montant TTC", "Reste à encaisser", "Statut"].map((label, i) => <th key={label} scope="col" className={`px-3 py-3 font-semibold ${i === 4 || i === 5 ? "text-right" : ""}`}>{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-black/[0.06]">{rows.map(({ invoice, status }) => <tr key={invoice.id} className={status === "overdue" ? "bg-red-50/50" : "hover:bg-zinc-50"}>
          <th scope="row" className="px-3 py-3 text-left font-semibold break-words">{invoice.number ?? "Sans numéro"}</th><td className="px-3 py-3 break-words">{invoice.clientName ?? "—"}</td><td className="px-3 py-3 whitespace-nowrap text-zinc-500">{dateLabel(invoice.issueDate)}</td><td className="px-3 py-3 whitespace-nowrap"><InvoiceDue invoice={invoice} status={status} today={today} /></td><td className="px-3 py-3 text-right font-semibold whitespace-nowrap tabular-nums">{amountLabel(invoice.total, invoice.currency)}</td><td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">{amountLabel(invoice.remaining, invoice.currency)}</td><td className="px-3 py-3"><Badge variant={statusDetails[status].variant}>{statusDetails[status].label}</Badge></td>
        </tr>)}</tbody>
      </table></div>
      <ul aria-label="Factures Qonto" className="grid gap-2 md:hidden">{rows.map(({ invoice, status }) => <li key={invoice.id} className={`rounded-xl border p-3 ${status === "overdue" ? "border-red-200 bg-red-50/50" : "border-black/10"}`}>
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="font-bold break-words">{invoice.number ?? "Sans numéro"}</p><p className="mt-1 text-xs break-words text-zinc-500">{invoice.clientName ?? "Client non renseigné"}</p></div><Badge variant={statusDetails[status].variant}>{statusDetails[status].label}</Badge></div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-zinc-500">Émission</dt><dd className="mt-1">{dateLabel(invoice.issueDate)}</dd></div><div><dt className="text-zinc-500">Échéance</dt><dd className="mt-1"><InvoiceDue invoice={invoice} status={status} today={today} /></dd></div><div><dt className="text-zinc-500">Montant TTC</dt><dd className="mt-1 font-semibold tabular-nums">{amountLabel(invoice.total, invoice.currency)}</dd></div><div><dt className="text-zinc-500">Reste à encaisser</dt><dd className="mt-1 tabular-nums">{amountLabel(invoice.remaining, invoice.currency)}</dd></div></dl>
      </li>)}</ul>
    </>}
    {pageCount > 1 && <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs"><Button variant="secondary" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Précédent</Button><span>Page {currentPage + 1} / {pageCount} · {results.length} factures</span><Button variant="secondary" size="sm" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Suivant</Button></div>}
    <p className="mt-4 text-xs text-zinc-500">Le statut de paiement vient de Qonto. Une facture est en retard si elle est à encaisser et si son échéance est passée. Un solde non communiqué est affiché « — ».</p>
  </>;
}

export function QontoInvoiceView({ demo = false }: { demo?: boolean }) {
  const [feed, setFeed] = useState<QontoInvoiceFeed | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
  const lastAttempt = useRef(0);
  const refresh = useCallback(async () => {
    if (demo || activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    lastAttempt.current = Date.now();
    setLoading(true);
    try {
      const response = await fetch("/api/integrations/qonto/invoices", { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => null) as QontoInvoiceFeed | { error: string } | null;
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) setFeed(null);
      if (!response.ok || !payload || "error" in payload) throw new Error(payload && "error" in payload ? payload.error : "Chargement des factures impossible.");
      setFeed(payload); setError("");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Chargement des factures impossible.");
    } finally {
      if (activeRequest.current === controller) { activeRequest.current = null; setLoading(false); }
    }
  }, [demo]);
  useEffect(() => {
    if (demo) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const whileVisible = () => { if (document.visibilityState === "visible" && Date.now() - lastAttempt.current >= 30_000) void refresh(); };
    const interval = window.setInterval(whileVisible, 120_000);
    window.addEventListener("focus", whileVisible);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); window.removeEventListener("focus", whileVisible); activeRequest.current?.abort(); activeRequest.current = null; };
  }, [demo, refresh]);
  return <Card aria-busy={loading}>
    <CardHeader className="flex-wrap"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">Factures clients Qonto</h2><Badge>Lecture seule</Badge></div><p className="mt-1 text-xs leading-5 text-zinc-500">Suivi des échéances, sans création de facture, de prestation ou de paiement dans le logiciel.</p>{feed?.state === "ready" && <p className="mt-1 text-xs text-zinc-500">Actualisé le {refreshDate.format(new Date(feed.fetchedAt))}</p>}</div>
      {!demo && <Button variant="secondary" size="sm" disabled={loading} onClick={() => void refresh()}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Actualiser</Button>}
    </CardHeader>
    <CardContent>
      {demo && <p className="rounded-xl border border-black/10 bg-zinc-50 p-4 text-sm text-zinc-500">Les factures Qonto sont disponibles en mode connecté. Aucune donnée bancaire n’est chargée en démonstration.</p>}
      {error && <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="mt-0.5 size-4 shrink-0" /><p>{error}{feed?.state === "ready" && " La dernière liste consultée reste affichée : les statuts peuvent avoir changé."}</p></div>}
      {loading && !feed && !error && <p role="status" className="flex items-center gap-2 p-4 text-sm text-zinc-500"><LoaderCircle className="size-4 animate-spin" /> Chargement des factures Qonto…</p>}
      {(feed?.state === "not_connected" || feed?.state === "paused") && <div className="rounded-xl border border-black/10 bg-zinc-50 p-4 text-sm text-zinc-500">{feed.state === "paused" ? "La connexion Qonto est en pause. Réactivez-la pour consulter vos factures." : "Connectez votre compte Qonto dans Banque pour consulter vos factures clients."} <Link className="focus-ring rounded font-semibold text-brand-600" href="/banque">Ouvrir Banque →</Link></div>}
      {feed?.state === "ready" && <QontoInvoiceList invoices={feed.invoices} today={financialDateKey(new Date().toISOString())} />}
    </CardContent>
  </Card>;
}
