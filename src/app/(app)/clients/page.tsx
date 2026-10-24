"use client";

import { AlertTriangle, Building2, Car, ChevronRight, Mail, Merge, Pencil, Phone, Plus, Save, Search, Trash2, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/avatar";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { clientRevenueMetrics } from "@/lib/domain/calculations";
import { interventionStatusLabels } from "@/lib/domain/labels";
import { findDuplicateClientPairs } from "@/lib/domain/matching";
import type { Client } from "@/lib/domain/types";
import { useDemoStore, type ClientEditInput } from "@/lib/demo/store";
import { formatDate, formatMoney, initials, normalizeText } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace-provider";

function ClientsContent({ requestedClientId, requestedVehicleId }: { requestedClientId: string | null; requestedVehicleId: string | null }) {
  const data = useDemoStore();
  const router = useRouter();
  const { mode, workspace } = useWorkspace();
  const canManage = mode === "demo" || Boolean(workspace?.canManageBusiness);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Client | null>(() => data.clients.find((client) => client.id === requestedClientId && !client.archivedAt) ?? null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [clientDraft, setClientDraft] = useState<ClientEditInput | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const activeClients = useMemo(() => data.clients.filter((client) => !client.archivedAt), [data.clients]);
  const filtered = useMemo(() => {
    const needle = normalizeText(query);
    if (!needle) return activeClients;
    return activeClients.filter((client) => {
      const vehicles = data.vehicles.filter((vehicle) => vehicle.clientId === client.id);
      return normalizeText(`${client.company ?? ""} ${client.firstName} ${client.lastName} ${client.email} ${client.phone} ${vehicles.map((vehicle) => `${vehicle.make} ${vehicle.model} ${vehicle.registration}`).join(" ")}`).includes(needle);
    });
  }, [activeClients, data.vehicles, query]);

  const duplicateCandidates = useMemo(() => findDuplicateClientPairs(activeClients), [activeClients]);

  const activeClientIds = useMemo(() => new Set(activeClients.map((client) => client.id)), [activeClients]);
  const deletingVehicles = deletingClient ? data.vehicles.filter((vehicle) => vehicle.clientId === deletingClient.id).length : 0;
  const deletingInterventions = deletingClient ? data.interventions.filter((intervention) => intervention.clientId === deletingClient.id).length : 0;
  const deletingDocuments = deletingClient ? data.invoices.filter((invoice) => invoice.clientId === deletingClient.id).length + data.quotes.filter((quote) => quote.clientId === deletingClient.id).length : 0;

  const removeClient = () => {
    if (!deletingClient) return;
    data.removeClient(deletingClient.id);
    if (selected?.id === deletingClient.id) setSelected(null);
    setDeletingClient(null);
    toast.success("Contact supprimé", { description: "Il a été retiré des contacts actifs. Son historique est conservé." });
  };

  const closeSelectedClient = () => {
    setSelected(null);
    if (requestedClientId) router.replace("/clients", { scroll: false });
  };

  const openClientEditor = (client: Client) => {
    setEditingClientId(client.id);
    setClientDraft({
      kind: client.kind, company: client.company ?? "", firstName: client.firstName, lastName: client.lastName, email: client.email, phone: client.phone,
      address: client.address, postalCode: client.postalCode, city: client.city, source: client.source, notes: client.notes,
      vehicles: data.vehicles.filter((vehicle) => vehicle.clientId === client.id).map((vehicle) => ({ id: vehicle.id, make: vehicle.make, model: vehicle.model, registration: vehicle.registration, format: vehicle.format })),
    });
  };

  const closeClientEditor = () => {
    setEditingClientId(null);
    setClientDraft(null);
  };

  const saveClient = () => {
    if (!editingClientId || !clientDraft) return;
    if (clientDraft.kind === "business" && !clientDraft.company?.trim()) return toast.error("Renseignez le nom de l’entreprise");
    if (clientDraft.kind === "individual" && (clientDraft.firstName.trim().length < 2 || clientDraft.lastName.trim().length < 2)) return toast.error("Renseignez le prénom et le nom du contact");
    if (clientDraft.email && !/^\S+@\S+\.\S+$/.test(clientDraft.email)) return toast.error("L’adresse e-mail est invalide");
    if (clientDraft.vehicles.some((vehicle) => !vehicle.make.trim())) return toast.error("La marque est requise pour chaque véhicule");
    data.updateClient(editingClientId, clientDraft);
    setSelected((client) => client?.id === editingClientId ? { ...client, ...clientDraft, company: clientDraft.kind === "business" ? clientDraft.company : undefined } : client);
    closeClientEditor();
    toast.success("Contact mis à jour");
  };

  const clientMetrics = (clientId: string) => {
    return clientRevenueMetrics(
      clientId,
      data.invoices,
      data.interventions,
      data.payments,
      data.maintenanceContracts,
      data.maintenanceBillingPeriods,
    );
  };

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Relation client" title="Clients & véhicules" description="Une fiche unique pour retrouver les coordonnées, véhicules, prestations et documents sans double saisie." actions={canManage ? <Button variant="secondary" onClick={() => setDuplicateOpen(true)}><Merge className="size-4" /> Doublons <Badge className="ml-1">{duplicateCandidates.length}</Badge></Button> : undefined} />
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-md flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-600" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, société, téléphone, immatriculation…" className="pl-10" /></div>
            <div className="flex items-center gap-2 text-xs text-zinc-500"><Badge>{filtered.length} clients</Badge><Badge>{data.vehicles.filter((vehicle) => activeClientIds.has(vehicle.clientId)).length} véhicules</Badge></div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {filtered.map((client) => {
          const metrics = clientMetrics(client.id);
          const vehicles = data.vehicles.filter((vehicle) => vehicle.clientId === client.id);
          const owner = data.team.find((member) => member.id === client.ownerId);
          return (
            <div key={client.id} className="surface-interactive grid grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_6px_22px_rgba(47,40,72,.06)]">
              <button onClick={() => setSelected(client)} className="focus-ring group grid min-w-0 gap-4 p-4 text-left transition-colors hover:bg-orange-50/50 sm:grid-cols-[minmax(240px,1.2fr)_minmax(180px,1fr)_repeat(3,minmax(90px,.45fr))_24px] sm:items-center sm:p-5">
                <div className="flex min-w-0 items-center gap-3"><Avatar label={initials(client.firstName, client.lastName)} color={client.kind === "business" ? "#38bdf8" : owner?.color} /><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-bold text-zinc-900">{client.company || `${client.firstName} ${client.lastName}`}</p>{client.kind === "business" && <Building2 className="size-3.5 text-sky-600" />}</div><p className="mt-1 truncate text-xs text-zinc-500">{client.email || client.phone || "Aucune coordonnée"} · {client.city}</p></div></div>
                <div className="flex flex-wrap gap-1.5">{vehicles.length ? vehicles.map((vehicle) => <Badge key={vehicle.id}>{vehicle.make} {vehicle.model}</Badge>) : <span className="text-xs text-zinc-500">Aucun véhicule</span>}</div>
                <div><p className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">Réalisé</p><p className="mt-1 text-sm font-bold text-zinc-900">{formatMoney(metrics.revenue)}</p></div>
                <div><p className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">Encaissé</p><p className="mt-1 text-sm font-bold text-emerald-700">{formatMoney(metrics.collected)}</p></div>
                <div><p className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">Prestations</p><p className="mt-1 text-sm font-bold text-zinc-900">{metrics.interventions.length}</p></div>
                <ChevronRight className="hidden size-4 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-orange-600 sm:block" />
              </button>
              {canManage && <div className="m-3 flex gap-2 self-center"><button type="button" onClick={() => openClientEditor(client)} aria-label={`Modifier ${client.company || `${client.firstName} ${client.lastName}`}`} title="Modifier le contact" className="focus-ring grid size-9 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-600 shadow-sm transition hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700"><Pencil className="size-4" /></button><button type="button" onClick={() => setDeletingClient(client)} aria-label={`Supprimer ${client.company || `${client.firstName} ${client.lastName}`}`} title="Supprimer le contact" className="focus-ring grid size-9 place-items-center rounded-xl border border-red-100 bg-red-50 text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-100"><Trash2 className="size-4" /></button></div>}
            </div>
          );
        })}
      </div>

      <Modal open={Boolean(deletingClient)} onClose={() => setDeletingClient(null)} title="Supprimer ce contact ?" description={deletingClient?.company || `${deletingClient?.firstName ?? ""} ${deletingClient?.lastName ?? ""}`.trim()}>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <p className="flex items-center gap-2 text-sm font-bold"><AlertTriangle className="size-4" /> Le contact sera retiré des listes actives</p>
          <p className="mt-2 text-xs leading-5 text-amber-800">Ses anciennes prestations, factures et devis resteront conservés avec son nom pour préserver l’historique de l’entreprise.</p>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[["Véhicules", deletingVehicles], ["Prestations", deletingInterventions], ["Documents", deletingDocuments]].map(([label, value]) => <div key={label} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"><p className="text-lg font-extrabold text-zinc-900">{value}</p><p className="mt-1 text-[10px] font-semibold text-zinc-500">{label}</p></div>)}
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeletingClient(null)}>Annuler</Button><Button variant="danger" onClick={removeClient}><Trash2 className="size-4" /> Supprimer le contact</Button></div>
      </Modal>

      <Modal open={Boolean(selected)} onClose={closeSelectedClient} title={selected?.company || `${selected?.firstName ?? ""} ${selected?.lastName ?? ""}`} description={selected?.kind === "business" ? "Client professionnel" : "Client particulier"} className="sm:max-w-3xl">
        {selected && (() => {
          const metrics = clientMetrics(selected.id);
          const vehicles = data.vehicles.filter((vehicle) => vehicle.clientId === selected.id);
          const recentInterventions = [...metrics.interventions]
            .sort((a, b) => (b.startAt ?? b.createdAt).localeCompare(a.startAt ?? a.createdAt))
            .slice(0, 6);
          return <div className="space-y-6">
            <div className="flex flex-wrap gap-2">{selected.phone && <a href={`tel:${selected.phone}`} className={buttonVariants({ size: "sm" })}><Phone className="size-3.5" /> Appeler</a>}{selected.email && <a href={`mailto:${selected.email}`} className={buttonVariants({ size: "sm", variant: "secondary" })}><Mail className="size-3.5" /> E-mail</a>}{canManage && <Button size="sm" variant="secondary" onClick={() => openClientEditor(selected)}><Pencil className="size-3.5" /> Modifier la fiche</Button>}</div>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[
              ["Montant des prestations", formatMoney(metrics.revenue)], ["Encaissé", formatMoney(metrics.collected)], ["À encaisser", formatMoney(Math.max(metrics.revenue - metrics.collected, 0))], ["Panier moyen", formatMoney(metrics.revenueEntryCount ? Math.round(metrics.revenue / metrics.revenueEntryCount) : 0)], ["Prestations", String(metrics.interventions.length)], ["Factures facultatives", String(metrics.invoices.length)],
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"><p className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">{label}</p><p className="mt-2 text-lg font-bold text-zinc-900">{value}</p></div>)}</section>
            <section><h3 className="mb-3 text-sm font-bold">Coordonnées</h3><div className="grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-900 sm:grid-cols-2"><p><span className="block text-xs text-zinc-500">Téléphone</span>{selected.phone || "—"}</p><p><span className="block text-xs text-zinc-500">E-mail</span>{selected.email || "—"}</p><p><span className="block text-xs text-zinc-500">Adresse</span>{selected.address || "À compléter"}</p><p><span className="block text-xs text-zinc-500">Acquisition</span>{selected.source}</p></div></section>
            <section><h3 className="mb-3 text-sm font-bold">Véhicules</h3><div className="grid gap-3 sm:grid-cols-2">{vehicles.map((vehicle) => <div key={vehicle.id} className={`rounded-2xl border p-4 transition ${vehicle.id === requestedVehicleId ? "border-orange-300 bg-orange-50 ring-2 ring-orange-100" : "border-zinc-200 bg-zinc-50"}`}><div className="flex items-center gap-3"><span className={`grid size-9 place-items-center rounded-xl ${vehicle.id === requestedVehicleId ? "bg-orange-100 text-orange-700" : "bg-sky-50 text-sky-700"}`}><Car className="size-4" /></span><div><p className="text-sm font-bold text-zinc-900">{vehicle.make} {vehicle.model}</p><p className="text-xs text-zinc-500">{vehicle.registration || "Sans immatriculation"} · {vehicle.format}</p></div></div></div>)}</div></section>
            <section><h3 className="mb-3 text-sm font-bold">Historique récent</h3><div className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200">{recentInterventions.length === 0 ? <p className="p-5 text-center text-xs text-zinc-500">Aucune prestation enregistrée pour ce contact.</p> : recentInterventions.map((item) => <Link key={item.id} href={`/prestations?intervention=${item.id}`} onClick={() => setSelected(null)} className="focus-ring group flex items-center justify-between gap-4 p-4 transition hover:bg-orange-50/60"><div><p className="text-sm font-semibold text-zinc-900 group-hover:text-orange-800">{item.title}</p><p className="mt-1 text-xs text-zinc-500">{formatDate(item.startAt, { day: "2-digit", month: "long", year: "numeric" })}</p></div><div className="flex items-center gap-2"><StatusBadge status={item.status}>{interventionStatusLabels[item.status]}</StatusBadge><ChevronRight className="size-4 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-orange-600" /></div></Link>)}</div></section>
          </div>;
        })()}
      </Modal>

      <Modal open={Boolean(editingClientId && clientDraft)} onClose={closeClientEditor} title="Modifier le contact" description="Coordonnées, acquisition et véhicules" className="sm:max-w-3xl">
        {clientDraft && <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Type"><Select value={clientDraft.kind} onChange={(event) => setClientDraft({ ...clientDraft, kind: event.target.value as ClientEditInput["kind"] })}><option value="individual">Particulier</option><option value="business">Professionnel</option></Select></Field><Field label={clientDraft.kind === "business" ? "Société" : "Société (facultatif)"}><Input value={clientDraft.company ?? ""} onChange={(event) => setClientDraft({ ...clientDraft, company: event.target.value })} /></Field></div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label={clientDraft.kind === "business" ? "Prénom du contact (facultatif)" : "Prénom"}><Input value={clientDraft.firstName} onChange={(event) => setClientDraft({ ...clientDraft, firstName: event.target.value })} /></Field><Field label={clientDraft.kind === "business" ? "Nom du contact (facultatif)" : "Nom"}><Input value={clientDraft.lastName} onChange={(event) => setClientDraft({ ...clientDraft, lastName: event.target.value })} /></Field></div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Téléphone (facultatif)"><Input inputMode="tel" value={clientDraft.phone} onChange={(event) => setClientDraft({ ...clientDraft, phone: event.target.value })} /></Field><Field label="E-mail (facultatif)"><Input type="email" value={clientDraft.email} onChange={(event) => setClientDraft({ ...clientDraft, email: event.target.value })} /></Field></div>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px_1fr]"><Field label="Adresse"><Input value={clientDraft.address} onChange={(event) => setClientDraft({ ...clientDraft, address: event.target.value })} /></Field><Field label="Code postal"><Input value={clientDraft.postalCode} onChange={(event) => setClientDraft({ ...clientDraft, postalCode: event.target.value })} /></Field><Field label="Ville"><Input value={clientDraft.city} onChange={(event) => setClientDraft({ ...clientDraft, city: event.target.value })} /></Field></div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Source"><Select value={clientDraft.source} onChange={(event) => setClientDraft({ ...clientDraft, source: event.target.value })}>{data.settings.leadSources.map((source) => <option key={source}>{source}</option>)}</Select></Field><Field label="Notes"><Textarea rows={2} value={clientDraft.notes} onChange={(event) => setClientDraft({ ...clientDraft, notes: event.target.value })} /></Field></div>
          <section><div className="flex items-center justify-between"><div><h3 className="text-sm font-bold">Véhicules</h3><p className="mt-1 text-xs text-zinc-500">Modifiez les véhicules existants ou ajoutez-en un.</p></div><Button size="sm" variant="secondary" onClick={() => setClientDraft({ ...clientDraft, vehicles: [...clientDraft.vehicles, { make: "", model: "", registration: "", format: data.settings.vehicleFormats[0] ?? "Autre" }] })}><Plus className="size-3.5" /> Ajouter</Button></div><div className="mt-3 grid gap-3">{clientDraft.vehicles.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-200 p-5 text-center text-xs text-zinc-500">Aucun véhicule enregistré.</p> : clientDraft.vehicles.map((vehicle, index) => <div key={vehicle.id ?? `new-${index}`} className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"><Field label="Marque"><Input value={vehicle.make} onChange={(event) => setClientDraft({ ...clientDraft, vehicles: clientDraft.vehicles.map((item, itemIndex) => itemIndex === index ? { ...item, make: event.target.value } : item) })} /></Field><Field label="Modèle"><Input value={vehicle.model} onChange={(event) => setClientDraft({ ...clientDraft, vehicles: clientDraft.vehicles.map((item, itemIndex) => itemIndex === index ? { ...item, model: event.target.value } : item) })} /></Field><Field label="Immatriculation"><Input value={vehicle.registration} onChange={(event) => setClientDraft({ ...clientDraft, vehicles: clientDraft.vehicles.map((item, itemIndex) => itemIndex === index ? { ...item, registration: event.target.value } : item) })} /></Field><Field label="Format"><Select value={vehicle.format} onChange={(event) => setClientDraft({ ...clientDraft, vehicles: clientDraft.vehicles.map((item, itemIndex) => itemIndex === index ? { ...item, format: event.target.value } : item) })}>{data.settings.vehicleFormats.map((format) => <option key={format}>{format}</option>)}</Select></Field>{!vehicle.id && <Button className="self-end" size="sm" variant="ghost" aria-label="Retirer le nouveau véhicule" onClick={() => setClientDraft({ ...clientDraft, vehicles: clientDraft.vehicles.filter((_, itemIndex) => itemIndex !== index) })}><X className="size-4" /></Button>}</div>)}</div></section>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={closeClientEditor}>Annuler</Button><Button onClick={saveClient}><Save className="size-4" /> Enregistrer les modifications</Button></div>
        </div>}
      </Modal>

      <Modal open={duplicateOpen} onClose={() => setDuplicateOpen(false)} title="Fusion des doublons" description="Les rapprochements ambigus ne sont jamais appliqués automatiquement.">
        {duplicateCandidates.length === 0 ? <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 p-10 text-center"><UserRound className="size-8 text-zinc-700" /><p className="mt-3 text-sm font-semibold">Aucun doublon probable</p><p className="mt-1 text-xs text-zinc-600">Seules les coordonnées renseignées et les identités non vides sont comparées.</p></div> : duplicateCandidates.map(([a, b, reason]) => <div key={`${a.id}-${b.id}`} className="rounded-xl border border-white/10 p-4"><Badge variant="yellow">{reason}</Badge><p className="mt-3 text-sm font-semibold">{a.company || `${a.firstName} ${a.lastName}`} ↔ {b.company || `${b.firstName} ${b.lastName}`}</p><p className="mt-2 text-xs leading-5 text-zinc-600">La première fiche est conservée ; véhicules, documents, prestations et avis de la seconde y seront rattachés.</p><Button className="mt-3" size="sm" onClick={() => { data.mergeClients(a.id, b.id); toast.success("Clients fusionnés et historique réaffecté"); }}><Merge className="size-3.5" /> Fusionner dans la première fiche</Button></div>)}
      </Modal>
    </div>
  );
}

function ClientsRouteContent() {
  const searchParams = useSearchParams();
  const requestedClientId = searchParams.get("client");
  const requestedVehicleId = searchParams.get("vehicle");
  return <ClientsContent key={`${requestedClientId ?? "list"}:${requestedVehicleId ?? "none"}`} requestedClientId={requestedClientId} requestedVehicleId={requestedVehicleId} />;
}

export default function ClientsPage() {
  return <Suspense fallback={<div className="min-h-72" />}><ClientsRouteContent /></Suspense>;
}
