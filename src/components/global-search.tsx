"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { interventionStatusLabels } from "@/lib/domain/labels";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney, normalizeText } from "@/lib/utils";
import { Input } from "./ui/field";
import { Modal } from "./ui/modal";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const clients = useDemoStore((state) => state.clients);
  const vehicles = useDemoStore((state) => state.vehicles);
  const invoices = useDemoStore((state) => state.invoices);
  const quotes = useDemoStore((state) => state.quotes);
  const interventions = useDemoStore((state) => state.interventions);
  const maintenanceContracts = useDemoStore((state) => state.maintenanceContracts);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const results = useMemo(() => {
    const needle = normalizeText(query);
    if (!needle) return [];
    const activeClients = clients.filter((client) => !client.archivedAt);
    const activeClientIds = new Set(activeClients.map((client) => client.id));
    const clientNames = new Map(activeClients.map((client) => [client.id, client.company || `${client.firstName} ${client.lastName}`.trim()]));
    return [
      ...activeClients.map((client) => ({ type: "Client", title: client.company || `${client.firstName} ${client.lastName}`, detail: [client.phone, client.email, client.city].filter(Boolean).join(" · ") || "Coordonnées à compléter", href: `/clients?client=${client.id}` })),
      ...vehicles.filter((vehicle) => activeClientIds.has(vehicle.clientId)).map((vehicle) => ({ type: "Véhicule", title: `${vehicle.make} ${vehicle.model}`.trim() || vehicle.format, detail: [vehicle.registration, vehicle.format, clientNames.get(vehicle.clientId)].filter(Boolean).join(" · "), href: `/clients?client=${vehicle.clientId}&vehicle=${vehicle.id}` })),
      ...interventions.filter((intervention) => activeClientIds.has(intervention.clientId)).map((intervention) => ({ type: "Prestation", title: intervention.title, detail: [clientNames.get(intervention.clientId), interventionStatusLabels[intervention.status], formatDate(intervention.startAt, { day: "2-digit", month: "short", year: "numeric" }), formatMoney(intervention.items.reduce((sum, item) => sum + item.revenueAllocated, 0))].filter(Boolean).join(" · "), href: `/prestations?intervention=${intervention.id}` })),
      ...maintenanceContracts.filter((contract) => activeClientIds.has(contract.clientId)).map((contract) => ({ type: "Entretien", title: contract.title, detail: [clientNames.get(contract.clientId), contract.billingFrequency === "monthly" ? "Paiement mensuel" : contract.billingFrequency === "annual" ? "Paiement annuel" : `Paiement unique ${contract.termMonths ?? 12} mois`, formatMoney(contract.billingAmount)].join(" · "), href: "/entretiens" })),
      ...quotes.map((quote) => ({ type: "Devis", title: quote.number, detail: [clientNames.get(quote.clientId), formatMoney(quote.totalIncludingTax)].filter(Boolean).join(" · "), href: "/documents?tab=quotes" })),
      ...invoices.map((invoice) => ({ type: "Facture", title: invoice.number, detail: [clientNames.get(invoice.clientId), formatMoney(invoice.totalIncludingTax)].filter(Boolean).join(" · "), href: "/documents?tab=invoices" })),
    ].filter((item) => normalizeText(`${item.title} ${item.detail}`).includes(needle)).slice(0, 9);
  }, [clients, interventions, invoices, maintenanceContracts, query, quotes, vehicles]);

  return (
    <>
      <button className="focus-ring group flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[0.075] bg-white/[0.035] px-3 text-left text-sm text-zinc-500 transition-[color,background-color,border-color,box-shadow] hover:border-brand-400/20 hover:bg-white/[0.065] hover:text-zinc-300 hover:shadow-sm sm:max-w-sm" onClick={() => setOpen(true)}>
        <Search className="size-4 shrink-0 transition-[color,transform] duration-200 group-hover:scale-110 group-hover:text-brand-500" /><span className="truncate">Rechercher partout…</span><kbd className="ml-auto hidden rounded-md border border-white/8 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors group-hover:border-brand-400/20 group-hover:text-brand-600 md:inline">Ctrl K</kbd>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Recherche globale" description="Prestations, entretiens mensuels, clients, véhicules et documents facultatifs.">
        <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, téléphone, immatriculation, numéro…" />
        <div className="mt-4 grid gap-1">
          {query && results.length === 0 && <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">Aucun résultat. Essayez un nom ou un numéro.</p>}
          {results.map((result, index) => (
            <Link key={`${result.type}-${result.title}-${index}`} href={result.href} onClick={() => setOpen(false)} className="focus-ring row-interactive flex items-center gap-4 rounded-xl p-3">
              <span className="w-16 text-[10px] font-bold tracking-wider text-brand-400 uppercase">{result.type}</span>
              <span className="min-w-0"><span className="block truncate text-sm font-semibold text-zinc-200">{result.title}</span><span className="block truncate text-xs text-zinc-500">{result.detail}</span></span>
            </Link>
          ))}
        </div>
      </Modal>
    </>
  );
}
