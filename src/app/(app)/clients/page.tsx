"use client";

import { Building2, Car, ChevronRight, Mail, Merge, Phone, Search, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { paymentsForInvoice } from "@/lib/domain/calculations";
import type { Client } from "@/lib/domain/types";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney, initials, normalizePhone, normalizeText } from "@/lib/utils";

export default function ClientsPage() {
  const data = useDemoStore();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Client | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const filtered = useMemo(() => {
    const needle = normalizeText(query);
    if (!needle) return data.clients;
    return data.clients.filter((client) => {
      const vehicles = data.vehicles.filter((vehicle) => vehicle.clientId === client.id);
      return normalizeText(`${client.company ?? ""} ${client.firstName} ${client.lastName} ${client.email} ${client.phone} ${vehicles.map((vehicle) => `${vehicle.make} ${vehicle.model} ${vehicle.registration}`).join(" ")}`).includes(needle);
    });
  }, [data.clients, data.vehicles, query]);

  const duplicateCandidates = useMemo(() => {
    const pairs: Array<[Client, Client, string]> = [];
    data.clients.forEach((client, index) => {
      data.clients.slice(index + 1).forEach((other) => {
        const sameEmail = client.email && client.email === other.email;
        const samePhone = normalizePhone(client.phone) === normalizePhone(other.phone);
        const sameName = normalizeText(`${client.firstName} ${client.lastName}`) === normalizeText(`${other.firstName} ${other.lastName}`);
        if (sameEmail || samePhone || sameName) pairs.push([client, other, sameEmail ? "Même e-mail" : samePhone ? "Même téléphone" : "Même nom"]);
      });
    });
    return pairs;
  }, [data.clients]);

  const clientMetrics = (clientId: string) => {
    const invoices = data.invoices.filter((invoice) => invoice.clientId === clientId);
    const invoiced = invoices.reduce((sum, invoice) => sum + invoice.totalIncludingTax, 0);
    const collected = invoices.reduce((sum, invoice) => sum + paymentsForInvoice(invoice.id, data.payments), 0);
    const interventions = data.interventions.filter((item) => item.clientId === clientId);
    return { invoices, invoiced, collected, interventions };
  };

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Relation client" title="Clients & véhicules" description="Une fiche unique pour retrouver les coordonnées, véhicules, prestations et documents sans double saisie." actions={<Button variant="secondary" onClick={() => setDuplicateOpen(true)}><Merge className="size-4" /> Doublons <Badge className="ml-1">{duplicateCandidates.length}</Badge></Button>} />
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-md flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-600" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, société, téléphone, immatriculation…" className="pl-10" /></div>
            <div className="flex items-center gap-2 text-xs text-zinc-500"><Badge>{filtered.length} clients</Badge><Badge>{data.vehicles.length} véhicules</Badge></div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {filtered.map((client) => {
          const metrics = clientMetrics(client.id);
          const vehicles = data.vehicles.filter((vehicle) => vehicle.clientId === client.id);
          const owner = data.team.find((member) => member.id === client.ownerId);
          return (
            <button key={client.id} onClick={() => setSelected(client)} className="focus-ring group grid gap-4 rounded-2xl border border-white/[0.07] bg-ink-850/90 p-4 text-left transition hover:-translate-y-0.5 hover:border-white/[0.13] sm:grid-cols-[minmax(240px,1.2fr)_minmax(180px,1fr)_repeat(3,minmax(90px,.45fr))_24px] sm:items-center sm:p-5">
              <div className="flex min-w-0 items-center gap-3"><Avatar label={initials(client.firstName, client.lastName)} color={client.kind === "business" ? "#38bdf8" : owner?.color} /><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-bold text-zinc-200">{client.company || `${client.firstName} ${client.lastName}`}</p>{client.kind === "business" && <Building2 className="size-3.5 text-sky-400" />}</div><p className="mt-1 truncate text-xs text-zinc-500">{client.email || client.phone} · {client.city}</p></div></div>
              <div className="flex flex-wrap gap-1.5">{vehicles.length ? vehicles.map((vehicle) => <Badge key={vehicle.id}>{vehicle.make} {vehicle.model}</Badge>) : <span className="text-xs text-zinc-600">Aucun véhicule</span>}</div>
              <div><p className="text-[10px] font-semibold tracking-wider text-zinc-600 uppercase">Facturé</p><p className="mt-1 text-sm font-bold">{formatMoney(metrics.invoiced)}</p></div>
              <div><p className="text-[10px] font-semibold tracking-wider text-zinc-600 uppercase">Encaissé</p><p className="mt-1 text-sm font-bold text-emerald-300">{formatMoney(metrics.collected)}</p></div>
              <div><p className="text-[10px] font-semibold tracking-wider text-zinc-600 uppercase">Prestations</p><p className="mt-1 text-sm font-bold">{metrics.interventions.length}</p></div>
              <ChevronRight className="hidden size-4 text-zinc-700 transition group-hover:translate-x-0.5 group-hover:text-zinc-400 sm:block" />
            </button>
          );
        })}
      </div>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.company || `${selected?.firstName ?? ""} ${selected?.lastName ?? ""}`} description={selected?.kind === "business" ? "Client professionnel" : "Client particulier"} className="sm:max-w-3xl">
        {selected && (() => {
          const metrics = clientMetrics(selected.id);
          const vehicles = data.vehicles.filter((vehicle) => vehicle.clientId === selected.id);
          return <div className="space-y-6">
            <div className="flex flex-wrap gap-2"><a href={`tel:${selected.phone}`}><Button size="sm"><Phone className="size-3.5" /> Appeler</Button></a><a href={`mailto:${selected.email}`}><Button size="sm" variant="secondary"><Mail className="size-3.5" /> E-mail</Button></a></div>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[
              ["Facturé", formatMoney(metrics.invoiced)], ["Encaissé", formatMoney(metrics.collected)], ["Panier moyen", formatMoney(metrics.invoices.length ? Math.round(metrics.invoiced / metrics.invoices.length) : 0)], ["Prestations", String(metrics.interventions.length)],
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><p className="text-[10px] font-semibold tracking-wider text-zinc-600 uppercase">{label}</p><p className="mt-2 text-lg font-bold">{value}</p></div>)}</section>
            <section><h3 className="mb-3 text-sm font-bold">Coordonnées</h3><div className="grid gap-3 rounded-2xl border border-white/[0.07] p-4 text-sm sm:grid-cols-2"><p><span className="block text-xs text-zinc-600">Téléphone</span>{selected.phone}</p><p><span className="block text-xs text-zinc-600">E-mail</span>{selected.email || "—"}</p><p><span className="block text-xs text-zinc-600">Adresse</span>{selected.address || "À compléter"}</p><p><span className="block text-xs text-zinc-600">Acquisition</span>{selected.source}</p></div></section>
            <section><h3 className="mb-3 text-sm font-bold">Véhicules</h3><div className="grid gap-3 sm:grid-cols-2">{vehicles.map((vehicle) => <div key={vehicle.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-orange-400/10 text-orange-300"><Car className="size-4" /></span><div><p className="text-sm font-bold">{vehicle.make} {vehicle.model}</p><p className="text-xs text-zinc-500">{vehicle.registration} · {vehicle.format}</p></div></div></div>)}</div></section>
            <section><h3 className="mb-3 text-sm font-bold">Historique récent</h3><div className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07]">{metrics.interventions.map((item) => <div key={item.id} className="flex items-center justify-between gap-4 p-4"><div><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-zinc-600">{formatDate(item.startAt, { day: "2-digit", month: "long", year: "numeric" })}</p></div><Badge>{item.status}</Badge></div>)}</div></section>
          </div>;
        })()}
      </Modal>

      <Modal open={duplicateOpen} onClose={() => setDuplicateOpen(false)} title="Fusion des doublons" description="Les rapprochements ambigus ne sont jamais appliqués automatiquement.">
        {duplicateCandidates.length === 0 ? <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 p-10 text-center"><UserRound className="size-8 text-zinc-700" /><p className="mt-3 text-sm font-semibold">Aucun doublon probable</p><p className="mt-1 text-xs text-zinc-600">E-mails, téléphones et noms normalisés ont été comparés.</p></div> : duplicateCandidates.map(([a, b, reason]) => <div key={`${a.id}-${b.id}`} className="rounded-xl border border-white/10 p-4"><Badge variant="yellow">{reason}</Badge><p className="mt-3 text-sm font-semibold">{a.firstName} {a.lastName} ↔ {b.firstName} {b.lastName}</p><p className="mt-2 text-xs leading-5 text-zinc-600">La première fiche est conservée ; véhicules, documents, prestations et avis de la seconde y seront rattachés.</p><Button className="mt-3" size="sm" onClick={() => { data.mergeClients(a.id, b.id); toast.success("Clients fusionnés et historique réaffecté"); }}><Merge className="size-3.5" /> Fusionner dans la première fiche</Button></div>)}
      </Modal>
    </div>
  );
}
