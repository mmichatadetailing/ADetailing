"use client";

import { AlertTriangle, Check, FileCheck2, Link2, LoaderCircle, Plus, UploadCloud, WalletCards, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { paymentStatusForInvoice, paymentsForInvoice } from "@/lib/domain/calculations";
import { invoiceStatusLabels, paymentStatusLabels, quoteStatusLabels } from "@/lib/domain/labels";
import { scoreQuoteForInvoice } from "@/lib/domain/matching";
import type { Invoice } from "@/lib/domain/types";
import { useDemoStore } from "@/lib/demo/store";
import type { ParsedHenrriDocument } from "@/lib/import/henrri-parser";
import { formatDate, formatMoney } from "@/lib/utils";

type ImportResponse = { fileName: string; fileSize: number; parsed: ParsedHenrriDocument };

export default function DocumentsPage() {
  const data = useDemoStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"quotes" | "invoices" | "imports">("invoices");
  const [loading, setLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [paymentEuros, setPaymentEuros] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("Virement");
  const [dismissedMatchIds, setDismissedMatchIds] = useState<string[]>([]);

  const importFile = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/imports/henrri", { method: "POST", body: form });
      const payload = await response.json() as ImportResponse | { error: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Import impossible");
      setImportResult(payload);
      toast.success("PDF analysé — vérification humaine requise");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import impossible");
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const matchCandidates = useMemo(() => data.invoices.filter((invoice) => !invoice.quoteId && !dismissedMatchIds.includes(invoice.id)).map((invoice) => {
    const best = data.quotes.map((quote) => scoreQuoteForInvoice(invoice, quote)).sort((a, b) => b.score - a.score)[0];
    return { invoice, match: best };
  }).filter((item) => item.match && item.match.score >= 50), [data.invoices, data.quotes, dismissedMatchIds]);

  const validateImport = () => {
    if (!importResult || importResult.parsed.documentType === "unknown") return;
    data.importHenrriDocument(importResult.parsed, importResult.fileName);
    toast.success(importResult.parsed.documentType === "invoice" ? "Facture importée — paiement non confirmé" : "Devis importé");
    setImportResult(null);
    setTab(importResult.parsed.documentType === "invoice" ? "invoices" : "quotes");
  };

  const addPayment = () => {
    if (!paymentInvoice || paymentEuros <= 0) return toast.error("Saisissez un montant valide");
    const outstanding = paymentInvoice.totalIncludingTax - paymentsForInvoice(paymentInvoice.id, data.payments);
    if (Math.round(paymentEuros * 100) > outstanding) return toast.error("Le paiement dépasse le solde restant");
    data.addPayment(paymentInvoice.id, Math.round(paymentEuros * 100), paymentMethod);
    toast.success("Paiement enregistré et statut recalculé");
    setPaymentInvoice(null);
    setPaymentEuros(0);
  };

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Henrri reste la référence" title="Documents & paiements" description="Importez les PDF officiels, contrôlez les champs extraits, rapprochez les documents et confirmez séparément les encaissements." actions={<Button onClick={() => fileRef.current?.click()} disabled={loading}>{loading ? <LoaderCircle className="size-4 animate-spin" /> : <UploadCloud className="size-4" />} Importer un PDF</Button>} />
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple={false} className="hidden" onChange={(event) => importFile(event.target.files?.[0])} />
      <div className="flex flex-wrap gap-2">{([['invoices', 'Factures', data.invoices.length], ['quotes', 'Devis', data.quotes.length], ['imports', 'Rapprochements', matchCandidates.length]] as const).map(([id, label, count]) => <button key={id} onClick={() => setTab(id)} className={`focus-ring rounded-xl border px-4 py-2.5 text-xs font-semibold transition ${tab === id ? "border-brand-400/30 bg-brand-400/10 text-brand-300" : "border-white/[0.07] bg-white/[0.025] text-zinc-500 hover:text-zinc-300"}`}>{label} <span className="ml-1 opacity-60">{count}</span></button>)}</div>

      {tab === "invoices" && <Card><CardHeader><div><h2 className="font-bold">Factures Henrri</h2><p className="mt-1 text-xs text-zinc-500">Le statut du document et celui du paiement ne sont jamais confondus.</p></div><Badge variant="red">{data.invoices.filter((invoice) => paymentStatusForInvoice(invoice, data.payments) === "overdue").length} en retard</Badge></CardHeader><CardContent className="overflow-x-auto px-0 pb-1"><table className="w-full min-w-[860px] text-left text-xs"><thead className="text-[10px] tracking-wider text-zinc-600 uppercase"><tr>{["Numéro", "Client", "Émission", "Échéance", "Montant TTC", "Document", "Paiement", "Solde", ""].map((head) => <th key={head} className="px-4 py-3 font-semibold first:pl-5 last:pr-5">{head}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.055]">{data.invoices.map((invoice) => { const client = data.clients.find((item) => item.id === invoice.clientId); const paid = paymentsForInvoice(invoice.id, data.payments); const paymentStatus = paymentStatusForInvoice(invoice, data.payments); return <tr key={invoice.id} className="hover:bg-white/[0.02]"><td className="px-4 py-4 pl-5 font-bold">{invoice.number}</td><td className="px-4 py-4 text-zinc-400">{client?.company || `${client?.firstName} ${client?.lastName}`}</td><td className="px-4 py-4 text-zinc-500">{formatDate(invoice.issuedAt)}</td><td className="px-4 py-4 text-zinc-500">{formatDate(invoice.dueAt)}</td><td className="px-4 py-4 font-bold">{formatMoney(invoice.totalIncludingTax)}</td><td className="px-4 py-4"><StatusBadge status={invoice.status}>{invoiceStatusLabels[invoice.status]}</StatusBadge></td><td className="px-4 py-4"><StatusBadge status={paymentStatus}>{paymentStatusLabels[paymentStatus]}</StatusBadge></td><td className="px-4 py-4 font-semibold text-zinc-300">{formatMoney(Math.max(invoice.totalIncludingTax - paid, 0))}</td><td className="px-4 py-4 pr-5">{paymentStatus !== "paid" && <Button size="sm" variant="secondary" onClick={() => { setPaymentInvoice(invoice); setPaymentEuros(Math.max(invoice.totalIncludingTax - paid, 0) / 100); }}><Plus className="size-3.5" /> Paiement</Button>}</td></tr>; })}</tbody></table></CardContent></Card>}

      {tab === "quotes" && <Card><CardHeader><div><h2 className="font-bold">Devis Henrri</h2><p className="mt-1 text-xs text-zinc-500">Suivi commercial sans recréer l’éditeur légal.</p></div></CardHeader><CardContent className="overflow-x-auto px-0 pb-1"><table className="w-full min-w-[760px] text-left text-xs"><thead className="text-[10px] tracking-wider text-zinc-600 uppercase"><tr>{["Numéro", "Client", "Date", "Montant TTC", "Statut", "Relance", "Lignes"].map((head) => <th key={head} className="px-4 py-3 font-semibold first:pl-5 last:pr-5">{head}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.055]">{data.quotes.map((quote) => { const client = data.clients.find((item) => item.id === quote.clientId); return <tr key={quote.id} className="hover:bg-white/[0.02]"><td className="px-4 py-4 pl-5 font-bold">{quote.number}</td><td className="px-4 py-4 text-zinc-400">{client?.company || `${client?.firstName} ${client?.lastName}`}</td><td className="px-4 py-4 text-zinc-500">{formatDate(quote.issuedAt)}</td><td className="px-4 py-4 font-bold">{formatMoney(quote.totalIncludingTax)}</td><td className="px-4 py-4"><StatusBadge status={quote.status}>{quoteStatusLabels[quote.status]}</StatusBadge></td><td className="px-4 py-4 text-zinc-500">{formatDate(quote.nextFollowUpAt)}</td><td className="px-4 py-4 pr-5"><Badge>{quote.lines.length}</Badge></td></tr>; })}</tbody></table></CardContent></Card>}

      {tab === "imports" && <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]"><Card><CardContent className="p-5"><button onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); importFile(event.dataTransfer.files[0]); }} onClick={() => fileRef.current?.click()} className="focus-ring grid min-h-56 w-full place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.018] p-8 text-center transition hover:border-brand-400/30 hover:bg-brand-400/[0.025]"><span><UploadCloud className="mx-auto size-9 text-zinc-600" /><span className="mt-4 block text-sm font-bold">Déposez un PDF Henrri</span><span className="mt-2 block text-xs leading-5 text-zinc-600">Devis ou facture · 15 Mo maximum<br />Aucun paiement n’est déduit du document.</span></span></button></CardContent></Card><Card><CardHeader><div><h2 className="font-bold">Rapprochements proposés</h2><p className="mt-1 text-xs text-zinc-500">Score explicable, confirmation humaine obligatoire.</p></div></CardHeader><CardContent className="grid gap-3">{matchCandidates.length === 0 ? <p className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-600">Aucun rapprochement en attente.</p> : matchCandidates.map(({ invoice, match }) => { const quote = data.quotes.find((item) => item.id === match?.quoteId); return <div key={invoice.id} className="rounded-2xl border border-white/[0.07] p-4"><div className="flex flex-wrap items-center gap-2"><Badge variant={match && match.score >= 80 ? "green" : "yellow"}>{match?.score} %</Badge><p className="text-sm font-bold">{invoice.number}</p><Link2 className="size-3.5 text-zinc-600" /><p className="text-sm font-bold">{quote?.number}</p></div><p className="mt-2 text-xs text-zinc-600">{match?.reasons.join(" · ")}</p><div className="mt-4 flex gap-2"><Button size="sm" onClick={() => { if (quote) data.linkInvoiceToQuote(invoice.id, quote.id); toast.success("Rapprochement confirmé"); }}><Check className="size-3.5" /> Confirmer</Button><Button size="sm" variant="ghost" onClick={() => { setDismissedMatchIds((ids) => [...ids, invoice.id]); toast.info("Proposition ignorée pour cette session"); }}><X className="size-3.5" /> Ignorer</Button></div></div>; })}</CardContent></Card></div>}

      <Modal open={Boolean(paymentInvoice)} onClose={() => setPaymentInvoice(null)} title={`Ajouter un paiement · ${paymentInvoice?.number ?? ""}`} description="Un paiement peut être partiel. Le statut est recalculé à partir des encaissements.">
        <div className="grid gap-4"><div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-xs text-zinc-600">Solde restant</p><p className="mt-1 text-2xl font-bold">{paymentInvoice ? formatMoney(paymentInvoice.totalIncludingTax - paymentsForInvoice(paymentInvoice.id, data.payments)) : "—"}</p></div><Field label="Montant reçu (€)"><Input autoFocus min="0.01" type="number" step="0.01" value={paymentEuros} onChange={(event) => setPaymentEuros(Number(event.target.value))} /></Field><Field label="Moyen de paiement"><Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option>Virement</option><option>Carte</option><option>Espèces</option><option>Chèque</option></Select></Field><Button onClick={addPayment}><WalletCards className="size-4" /> Enregistrer le paiement</Button></div>
      </Modal>

      <Modal open={Boolean(importResult)} onClose={() => setImportResult(null)} title="Vérifier le document importé" description={importResult?.fileName} className="sm:max-w-3xl">
        {importResult && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-4">{[
          ["Type", importResult.parsed.documentType === "invoice" ? "Facture" : importResult.parsed.documentType === "quote" ? "Devis" : "Inconnu"], ["Numéro", importResult.parsed.number ?? "Manquant"], ["Date", formatDate(importResult.parsed.date, { day: "2-digit", month: "long", year: "numeric" })], ["Total TTC", importResult.parsed.totalIncludingTax === undefined ? "Manquant" : formatMoney(importResult.parsed.totalIncludingTax)],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><p className="text-[10px] font-bold tracking-wider text-zinc-600 uppercase">{label}</p><p className="mt-2 text-sm font-bold">{value}</p></div>)}</div><div className="rounded-xl border border-white/[0.07] p-4"><p className="text-xs text-zinc-600">Client détecté</p><p className="mt-1 text-sm font-bold">{importResult.parsed.company || importResult.parsed.clientName || "À renseigner"}</p></div>{importResult.parsed.lines.length > 0 && <div className="overflow-x-auto rounded-xl border border-white/[0.07]"><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-white/[0.025] text-zinc-600"><tr><th className="p-3">Désignation</th><th className="p-3">Qté</th><th className="p-3">Prix unit.</th><th className="p-3">Net</th><th className="p-3">Remise</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{importResult.parsed.lines.map((line, index) => <tr key={`${line.designation}-${index}`}><td className="p-3 font-semibold">{line.designation}</td><td className="p-3">{line.quantity}</td><td className="p-3">{formatMoney(line.unitPrice)}</td><td className="p-3">{formatMoney(line.netAmount)}</td><td className="p-3">{line.implicitDiscountDetected ? <Badge variant="yellow">{(line.discountRateBasisPoints / 100).toFixed(0)} %</Badge> : "—"}</td></tr>)}</tbody></table></div>}{importResult.parsed.missingFields.length > 0 && <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.055] p-4"><p className="flex items-center gap-2 text-xs font-bold text-amber-200"><AlertTriangle className="size-4" /> Champs manquants</p><p className="mt-2 text-xs text-zinc-500">{importResult.parsed.missingFields.join(" · ")}</p></div>}{importResult.parsed.warnings.map((warning) => <p key={warning} className="rounded-xl border border-white/[0.07] p-3 text-xs text-zinc-500">{warning}</p>)}<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setImportResult(null)}>Annuler</Button><Button disabled={importResult.parsed.documentType === "unknown"} onClick={validateImport}><FileCheck2 className="size-4" /> Valider l’import</Button></div></div>}
      </Modal>
    </div>
  );
}
