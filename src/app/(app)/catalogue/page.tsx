"use client";

import { Archive, ArrowDown, ArrowUp, Copy, Plus, Search, Tag, Timer, Trash2, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { getServicePricingMode, servicePriceRuleLabel, servicePricingModeLabels, vehicleCountTierLabel } from "@/lib/domain/service-pricing";
import type { ServiceKind, ServicePricingMode } from "@/lib/domain/types";
import { useDemoStore } from "@/lib/demo/store";
import { formatMoney, normalizeText } from "@/lib/utils";

const tabs: Array<{ id: "all" | ServiceKind | "formats" | "aliases"; label: string }> = [
  { id: "all", label: "Tout" },
  { id: "formula", label: "Formules" },
  { id: "option", label: "Options" },
  { id: "subscription", label: "Abonnements" },
  { id: "pack", label: "Packs" },
  { id: "formats", label: "Formats" },
  { id: "aliases", label: "Alias Henrri" },
];

type PriceRangeDraft = Record<string, { minimum: number; maximum: number }>;
type VehicleCountTierDraft = { id: string; minimumVehicles: number; maximumVehicles?: number; price: number };
type CustomPriceDraft = { id: string; label: string; minimum: number; maximum: number };

function emptyRanges(formats: string[]): PriceRangeDraft {
  return Object.fromEntries(formats.map((format) => [format, { minimum: 0, maximum: 0 }]));
}

function formatRange(minimum: number, maximum: number) {
  return minimum === maximum ? formatMoney(minimum) : `${formatMoney(minimum)} – ${formatMoney(maximum)}`;
}

function draftId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function initialForm(priceFormats: string[]) {
  return {
    name: "",
    kind: "formula" as ServiceKind,
    category: "Nettoyage",
    durationHours: 2,
    productEuros: 0,
    pricingMode: "vehicle_format" as ServicePricingMode,
    priceRanges: emptyRanges(priceFormats),
    vehicleCountTiers: [{ id: "initial-tier", minimumVehicles: 1, maximumVehicles: 3, price: 0 }] as VehicleCountTierDraft[],
    customPrices: [{ id: "initial-custom", label: "Tarif standard", minimum: 0, maximum: 0 }] as CustomPriceDraft[],
  };
}

export default function CataloguePage() {
  const data = useDemoStore();
  const priceFormats = data.settings.vehicleFormats.length > 0 ? data.settings.vehicleFormats : ["Tous formats"];
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("all");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(() => initialForm(priceFormats));
  const filtered = useMemo(() => data.services
    .filter((service) => (tab === "all" || tab === "formats" || tab === "aliases" || service.kind === tab) && (showArchived || service.active) && normalizeText(`${service.name} ${service.category} ${service.aliases.join(" ")}`).includes(normalizeText(query)))
    .sort((a, b) => a.displayOrder - b.displayOrder), [data.services, query, showArchived, tab]);

  const setRange = (format: string, key: "minimum" | "maximum", value: number) => {
    setForm((state) => {
      const current = state.priceRanges[format] ?? { minimum: 0, maximum: 0 };
      const next = key === "minimum" && current.maximum < value
        ? { minimum: value, maximum: value }
        : { ...current, [key]: value };
      return { ...state, priceRanges: { ...state.priceRanges, [format]: next } };
    });
  };

  const chooseKind = (kind: ServiceKind) => {
    setForm((state) => ({
      ...state,
      kind,
      pricingMode: kind === "subscription" ? (state.kind === "subscription" ? state.pricingMode : "vehicle_count") : "vehicle_format",
    }));
  };

  const updateVehicleCountTier = (id: string, patch: Partial<Omit<VehicleCountTierDraft, "id">>) => {
    setForm((state) => ({ ...state, vehicleCountTiers: state.vehicleCountTiers.map((tier) => tier.id === id ? { ...tier, ...patch } : tier) }));
  };

  const addVehicleCountTier = () => {
    setForm((state) => {
      const previous = state.vehicleCountTiers.at(-1);
      const minimumVehicles = previous?.maximumVehicles === undefined ? (previous?.minimumVehicles ?? 0) + 1 : previous.maximumVehicles + 1;
      return { ...state, vehicleCountTiers: [...state.vehicleCountTiers, { id: draftId("tier"), minimumVehicles, maximumVehicles: minimumVehicles + 2, price: 0 }] };
    });
  };

  const updateCustomPrice = (id: string, patch: Partial<Omit<CustomPriceDraft, "id">>) => {
    setForm((state) => ({ ...state, customPrices: state.customPrices.map((price) => price.id === id ? { ...price, ...patch } : price) }));
  };

  const create = () => {
    const pricingMode = form.kind === "subscription" ? form.pricingMode : "vehicle_format";
    let prices: Array<{ label: string; vehicleFormat?: string; minimumVehicleCount?: number; maximumVehicleCount?: number; amount: number; maximumAmount: number }>;
    if (pricingMode === "vehicle_count") {
      const tiers = [...form.vehicleCountTiers].sort((left, right) => left.minimumVehicles - right.minimumVehicles);
      const invalidTier = tiers.some((tier) => !Number.isInteger(tier.minimumVehicles) || tier.minimumVehicles < 1 || (tier.maximumVehicles !== undefined && (!Number.isInteger(tier.maximumVehicles) || tier.maximumVehicles < tier.minimumVehicles)) || !Number.isFinite(tier.price) || tier.price < 0);
      const invalidSequence = tiers[0]?.minimumVehicles !== 1 || tiers.some((tier, index) => {
        const next = tiers[index + 1];
        return Boolean(next && (tier.maximumVehicles === undefined || next.minimumVehicles !== tier.maximumVehicles + 1));
      });
      if (invalidTier || invalidSequence) return toast.error("Les paliers doivent commencer à 1 et se suivre sans trou ni chevauchement");
      prices = tiers.map((tier) => ({
        label: vehicleCountTierLabel(tier.minimumVehicles, tier.maximumVehicles),
        minimumVehicleCount: tier.minimumVehicles,
        maximumVehicleCount: tier.maximumVehicles,
        amount: Math.round(tier.price * 100),
        maximumAmount: Math.round(tier.price * 100),
      }));
    } else if (pricingMode === "custom") {
      const invalidRule = form.customPrices.some((price) => price.label.trim().length < 2 || !Number.isFinite(price.minimum) || !Number.isFinite(price.maximum) || price.minimum < 0 || price.maximum < price.minimum);
      const duplicateRule = new Set(form.customPrices.map((price) => normalizeText(price.label))).size !== form.customPrices.length;
      if (invalidRule || duplicateRule) return toast.error("Vérifiez les libellés et les montants de chaque règle personnalisée");
      prices = form.customPrices.map((price) => ({ label: price.label.trim(), amount: Math.round(price.minimum * 100), maximumAmount: Math.round(price.maximum * 100) }));
    } else {
      const ranges = priceFormats.map((format) => ({ format, ...(form.priceRanges[format] ?? { minimum: 0, maximum: 0 }) }));
      const invalidRange = ranges.some((range) => !Number.isFinite(range.minimum) || !Number.isFinite(range.maximum) || range.minimum < 0 || range.maximum < range.minimum);
      if (invalidRange) return toast.error("Vérifiez chaque fourchette de prix par type de véhicule");
      prices = ranges.map((range) => ({ label: range.format, vehicleFormat: range.format, amount: Math.round(range.minimum * 100), maximumAmount: Math.round(range.maximum * 100) }));
    }
    if (form.name.trim().length < 2 || form.category.trim().length < 2 || form.durationHours <= 0 || form.productEuros < 0) return toast.error("Vérifiez le nom, la catégorie, la durée et les coûts");
    data.addService({
      name: form.name.trim(),
      kind: form.kind,
      category: form.category.trim(),
      pricingMode,
      prices,
      targetDurationMinutes: Math.round(form.durationHours * 60),
      targetProductCost: Math.round(form.productEuros * 100),
    });
    toast.success(form.kind === "subscription" ? "Abonnement et règles tarifaires ajoutés" : "Offre et fourchettes ajoutées au catalogue");
    setAddOpen(false);
    setForm(initialForm(priceFormats));
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Offres & standards"
        title="Catalogue modifiable"
        description="Définissez une tarification par type de véhicule, par nombre de véhicules ou avec vos propres règles. Le prix final reste toujours modifiable."
        actions={<Button onClick={() => setAddOpen(true)}><Plus className="size-4" /> Nouvelle offre</Button>}
      />

      <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex w-max gap-1 rounded-xl border border-white/[0.07] bg-white/[0.025] p-1">
          {tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`focus-ring rounded-lg px-3 py-2 text-xs font-semibold transition ${tab === item.id ? "bg-brand-50 text-brand-700 shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}>{item.label}</button>)}
        </div>
      </div>

      {tab === "formats" ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.settings.vehicleFormats.map((format, index) => <Card key={format}><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm font-bold">{format}</p><p className="mt-1 text-xs text-zinc-600">{data.vehicles.filter((vehicle) => vehicle.format === format).length} véhicule(s)</p></div><Badge>Ordre {index + 1}</Badge></CardContent></Card>)}
        </section>
      ) : tab === "aliases" ? (
        <section className="grid gap-3">
          {data.services.flatMap((service) => service.aliases.map((alias) => ({ alias, service }))).map(({ alias, service }) => <div key={`${service.id}-${alias}`} className="flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-ink-850 p-4 sm:flex-row sm:items-center"><span className="grid size-9 place-items-center rounded-xl bg-sky-400/10 text-sky-300"><Tag className="size-4" /></span><div className="flex-1"><p className="text-sm font-semibold">{alias}</p><p className="mt-1 text-xs text-zinc-600">Intitulé détecté dans Henrri</p></div><span className="text-xs text-zinc-500">correspond à</span><Badge variant="blue">{service.name}</Badge></div>)}
        </section>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative max-w-sm flex-1"><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-600" /><Input className="pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une offre ou un alias…" /></div>
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-500"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="accent-brand-500" /> Afficher les archivées</label>
            <Badge>{filtered.length} offres</Badge>
          </div>
          <section className="grid gap-3 lg:grid-cols-2">
            {filtered.map((service) => {
              const pricingMode = getServicePricingMode(service);
              const minimum = service.prices.length ? Math.min(...service.prices.map((price) => price.amount)) : 0;
              const maximum = service.prices.length ? Math.max(...service.prices.map((price) => price.maximumAmount ?? price.amount)) : 0;
              const targetMargin = minimum - service.targetProductCost - service.targetTravelCost;
              return (
                <Card key={service.id} className={!service.active ? "opacity-60" : undefined}>
                  <CardContent className="p-5">
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-bold">{service.name}</h2><Badge variant={service.kind === "formula" ? "orange" : "neutral"}>{service.kind}</Badge>{service.kind === "subscription" && <Badge variant="blue">{servicePricingModeLabels[pricingMode]}</Badge>}{!service.active && <Badge variant="red">Archivée</Badge>}</div><p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">{service.clientDescription}</p></div>
                    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div><p className="text-[10px] text-zinc-600">{pricingMode === "vehicle_count" ? "Tarif unitaire" : "Fourchette globale"}</p><p className="mt-1 text-sm font-bold">{formatRange(minimum, maximum)}{pricingMode === "vehicle_count" ? "/véhicule" : ""}</p></div>
                      <div><p className="text-[10px] text-zinc-600">Durée cible</p><p className="mt-1 flex items-center gap-1 text-sm font-bold"><Timer className="size-3.5 text-zinc-600" /> {service.targetDurationMinutes / 60} h</p></div>
                      <div><p className="text-[10px] text-zinc-600">Marge mini.</p><p className="mt-1 text-sm font-bold text-emerald-300">{formatMoney(targetMargin)}</p></div>
                      <div><p className="text-[10px] text-zinc-600">Équipe</p><p className="mt-1 flex items-center gap-1 text-sm font-bold"><UsersRound className="size-3.5 text-zinc-600" /> {service.recommendedWorkers}</p></div>
                    </div>
                    {service.prices.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{service.prices.map((price, index) => <Badge key={`${servicePriceRuleLabel(price, pricingMode)}-${index}`} variant="blue">{servicePriceRuleLabel(price, pricingMode)} · {formatRange(price.amount, price.maximumAmount ?? price.amount)}{pricingMode === "vehicle_count" ? "/véhicule" : ""}</Badge>)}</div>}
                    {service.aliases.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{service.aliases.map((alias) => <Badge key={alias}>{alias}</Badge>)}</div>}
                    <div className="mt-5 flex flex-wrap items-center gap-1 border-t border-white/[0.06] pt-3"><Button size="sm" variant="ghost" onClick={() => data.reorderService(service.id, -1)} aria-label="Monter"><ArrowUp className="size-3.5" /></Button><Button size="sm" variant="ghost" onClick={() => data.reorderService(service.id, 1)} aria-label="Descendre"><ArrowDown className="size-3.5" /></Button><Button size="sm" variant="ghost" onClick={() => { data.duplicateService(service.id); toast.success("Offre dupliquée en brouillon"); }}><Copy className="size-3.5" /> Dupliquer</Button>{service.active && <Button size="sm" variant="ghost" className="ml-auto text-red-300" onClick={() => { data.archiveService(service.id); toast.success("Offre archivée, historique conservé"); }}><Archive className="size-3.5" /> Archiver</Button>}</div>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        </>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Nouvelle offre" description="Choisissez une logique tarifaire claire. Le prix final restera modifiable sur chaque prestation." className="sm:max-w-3xl">
        <div className="grid gap-4">
          <Field label="Nom"><Input autoFocus value={form.name} onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))} /></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Type"><Select value={form.kind} onChange={(event) => chooseKind(event.target.value as ServiceKind)}><option value="formula">Formule</option><option value="option">Option</option><option value="subscription">Abonnement</option><option value="pack">Pack</option></Select></Field><Field label="Catégorie"><Input value={form.category} onChange={(event) => setForm((state) => ({ ...state, category: event.target.value }))} /></Field></div>

          {form.kind === "subscription" && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4">
              <p className="text-sm font-bold text-sky-950">Comment le prix de l’abonnement varie-t-il ?</p>
              <p className="mt-1 text-xs text-sky-800">Cette logique déterminera le tarif conseillé lors de la création d’une prestation.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {(Object.entries(servicePricingModeLabels) as Array<[ServicePricingMode, string]>).map(([mode, label]) => (
                  <button key={mode} type="button" aria-pressed={form.pricingMode === mode} onClick={() => setForm((state) => ({ ...state, pricingMode: mode }))} className={`focus-ring rounded-xl border p-3 text-left text-xs font-bold transition ${form.pricingMode === mode ? "border-sky-400 bg-white text-sky-800 shadow-sm" : "border-sky-100 bg-white/60 text-zinc-600 hover:border-sky-300"}`}>{label}</button>
                ))}
              </div>
            </div>
          )}

          {form.kind !== "subscription" || form.pricingMode === "vehicle_format" ? (
            <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
              <div><p className="text-sm font-bold text-violet-900">Fourchettes TTC par type de véhicule</p><p className="mt-1 text-xs text-violet-700">Indiquez le minimum et le maximum habituellement pratiqués pour chaque catégorie.</p></div>
              <div className="mt-4 grid gap-3">
                {priceFormats.map((format) => <div key={format} className="grid items-end gap-3 rounded-xl border border-violet-100 bg-white p-3 sm:grid-cols-[1fr_120px_120px]"><p className="self-center text-xs font-bold">{format}</p><Field label="Minimum (€)"><Input min="0" type="number" step="0.01" value={form.priceRanges[format]?.minimum ?? 0} onChange={(event) => setRange(format, "minimum", Number(event.target.value))} /></Field><Field label="Maximum (€)"><Input min={form.priceRanges[format]?.minimum ?? 0} type="number" step="0.01" value={form.priceRanges[format]?.maximum ?? 0} onChange={(event) => setRange(format, "maximum", Number(event.target.value))} /></Field></div>)}
              </div>
            </div>
          ) : form.pricingMode === "vehicle_count" ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-sm font-bold text-emerald-950">Paliers par nombre de véhicules</p><p className="mt-1 text-xs text-emerald-800">Le prix indiqué est le tarif TTC par véhicule et par période d’abonnement.</p></div>
                <Button size="sm" variant="secondary" disabled={form.vehicleCountTiers.at(-1)?.maximumVehicles === undefined} onClick={addVehicleCountTier}><Plus className="size-3.5" /> Ajouter un palier</Button>
              </div>
              <div className="mt-4 grid gap-3">
                {form.vehicleCountTiers.map((tier) => (
                  <div key={tier.id} className="grid items-end gap-3 rounded-xl border border-emerald-100 bg-white p-3 sm:grid-cols-[110px_110px_1fr_auto]">
                    <Field label="De"><Input min="1" step="1" type="number" value={tier.minimumVehicles} onChange={(event) => updateVehicleCountTier(tier.id, { minimumVehicles: Number(event.target.value) })} /></Field>
                    <Field label="À"><Input min={tier.minimumVehicles} step="1" type="number" value={tier.maximumVehicles ?? ""} placeholder="Et +" onChange={(event) => updateVehicleCountTier(tier.id, { maximumVehicles: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>
                    <Field label="Prix TTC / véhicule (€)"><Input min="0" step="0.01" type="number" value={tier.price} onChange={(event) => updateVehicleCountTier(tier.id, { price: Number(event.target.value) })} /></Field>
                    <Button size="sm" variant="ghost" aria-label="Supprimer le palier" disabled={form.vehicleCountTiers.length === 1} onClick={() => setForm((state) => ({ ...state, vehicleCountTiers: state.vehicleCountTiers.filter((entry) => entry.id !== tier.id) }))}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-emerald-800">Laissez la borne « À » vide sur le dernier palier pour couvrir tous les volumes supérieurs.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-sm font-bold text-amber-950">Règles tarifaires personnalisées</p><p className="mt-1 text-xs text-amber-800">Nommez librement chaque cas : partenaire, flotte premium, sur devis…</p></div>
                <Button size="sm" variant="secondary" onClick={() => setForm((state) => ({ ...state, customPrices: [...state.customPrices, { id: draftId("custom"), label: "Nouvelle règle", minimum: 0, maximum: 0 }] }))}><Plus className="size-3.5" /> Ajouter une règle</Button>
              </div>
              <div className="mt-4 grid gap-3">
                {form.customPrices.map((price) => (
                  <div key={price.id} className="grid items-end gap-3 rounded-xl border border-amber-100 bg-white p-3 sm:grid-cols-[1fr_120px_120px_auto]">
                    <Field label="Nom de la règle"><Input value={price.label} onChange={(event) => updateCustomPrice(price.id, { label: event.target.value })} /></Field>
                    <Field label="Minimum (€)"><Input min="0" step="0.01" type="number" value={price.minimum} onChange={(event) => updateCustomPrice(price.id, { minimum: Number(event.target.value), maximum: Math.max(price.maximum, Number(event.target.value)) })} /></Field>
                    <Field label="Maximum (€)"><Input min={price.minimum} step="0.01" type="number" value={price.maximum} onChange={(event) => updateCustomPrice(price.id, { maximum: Number(event.target.value) })} /></Field>
                    <Button size="sm" variant="ghost" aria-label="Supprimer la règle" disabled={form.customPrices.length === 1} onClick={() => setForm((state) => ({ ...state, customPrices: state.customPrices.filter((entry) => entry.id !== price.id) }))}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Durée cible (h)"><Input min="0.25" type="number" step="0.25" value={form.durationHours} onChange={(event) => setForm((state) => ({ ...state, durationHours: Number(event.target.value) }))} /></Field><Field label="Coût produits (€)"><Input min="0" type="number" step="0.01" value={form.productEuros} onChange={(event) => setForm((state) => ({ ...state, productEuros: Number(event.target.value) }))} /></Field></div>
          <Button onClick={create}>{form.kind === "subscription" ? "Créer l’abonnement et ses règles" : "Créer l’offre et ses fourchettes"}</Button>
        </div>
      </Modal>
    </div>
  );
}
