"use client";

import { Archive, ArrowDown, ArrowUp, Copy, Plus, Search, Tag, Timer, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import type { ServiceKind } from "@/lib/domain/types";
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

function emptyRanges(formats: string[]): PriceRangeDraft {
  return Object.fromEntries(formats.map((format) => [format, { minimum: 0, maximum: 0 }]));
}

function formatRange(minimum: number, maximum: number) {
  return minimum === maximum ? formatMoney(minimum) : `${formatMoney(minimum)} – ${formatMoney(maximum)}`;
}

export default function CataloguePage() {
  const data = useDemoStore();
  const priceFormats = data.settings.vehicleFormats.length > 0 ? data.settings.vehicleFormats : ["Tous formats"];
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("all");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    kind: "formula" as ServiceKind,
    category: "Nettoyage",
    durationHours: 2,
    productEuros: 0,
    priceRanges: emptyRanges(priceFormats),
  });
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

  const create = () => {
    const ranges = priceFormats.map((format) => ({ format, ...(form.priceRanges[format] ?? { minimum: 0, maximum: 0 }) }));
    const invalidRange = ranges.some((range) => !Number.isFinite(range.minimum) || !Number.isFinite(range.maximum) || range.minimum < 0 || range.maximum < range.minimum);
    if (form.name.trim().length < 2 || form.durationHours <= 0 || form.productEuros < 0 || invalidRange) {
      return toast.error("Vérifiez le nom, la durée, les coûts et chaque fourchette de prix");
    }
    data.addService({
      name: form.name.trim(),
      kind: form.kind,
      category: form.category,
      prices: ranges.map((range) => ({ vehicleFormat: range.format, amount: Math.round(range.minimum * 100), maximumAmount: Math.round(range.maximum * 100) })),
      targetDurationMinutes: Math.round(form.durationHours * 60),
      targetProductCost: Math.round(form.productEuros * 100),
    });
    toast.success("Offre et fourchettes ajoutées au catalogue");
    setAddOpen(false);
    setForm({ name: "", kind: "formula", category: "Nettoyage", durationHours: 2, productEuros: 0, priceRanges: emptyRanges(priceFormats) });
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Offres & standards"
        title="Catalogue modifiable"
        description="Définissez une fourchette par format de véhicule. Le prix final restera libre lors de la création de chaque prestation."
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
              const minimum = service.prices.length ? Math.min(...service.prices.map((price) => price.amount)) : 0;
              const maximum = service.prices.length ? Math.max(...service.prices.map((price) => price.maximumAmount ?? price.amount)) : 0;
              const targetMargin = minimum - service.targetProductCost - service.targetTravelCost;
              return (
                <Card key={service.id} className={!service.active ? "opacity-60" : undefined}>
                  <CardContent className="p-5">
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-bold">{service.name}</h2><Badge variant={service.kind === "formula" ? "orange" : "neutral"}>{service.kind}</Badge>{!service.active && <Badge variant="red">Archivée</Badge>}</div><p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">{service.clientDescription}</p></div>
                    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div><p className="text-[10px] text-zinc-600">Fourchette globale</p><p className="mt-1 text-sm font-bold">{formatRange(minimum, maximum)}</p></div>
                      <div><p className="text-[10px] text-zinc-600">Durée cible</p><p className="mt-1 flex items-center gap-1 text-sm font-bold"><Timer className="size-3.5 text-zinc-600" /> {service.targetDurationMinutes / 60} h</p></div>
                      <div><p className="text-[10px] text-zinc-600">Marge mini.</p><p className="mt-1 text-sm font-bold text-emerald-300">{formatMoney(targetMargin)}</p></div>
                      <div><p className="text-[10px] text-zinc-600">Équipe</p><p className="mt-1 flex items-center gap-1 text-sm font-bold"><UsersRound className="size-3.5 text-zinc-600" /> {service.recommendedWorkers}</p></div>
                    </div>
                    {service.prices.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{service.prices.map((price) => <Badge key={price.vehicleFormat} variant="blue">{price.vehicleFormat} · {formatRange(price.amount, price.maximumAmount ?? price.amount)}</Badge>)}</div>}
                    {service.aliases.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{service.aliases.map((alias) => <Badge key={alias}>{alias}</Badge>)}</div>}
                    <div className="mt-5 flex flex-wrap items-center gap-1 border-t border-white/[0.06] pt-3"><Button size="sm" variant="ghost" onClick={() => data.reorderService(service.id, -1)} aria-label="Monter"><ArrowUp className="size-3.5" /></Button><Button size="sm" variant="ghost" onClick={() => data.reorderService(service.id, 1)} aria-label="Descendre"><ArrowDown className="size-3.5" /></Button><Button size="sm" variant="ghost" onClick={() => { data.duplicateService(service.id); toast.success("Offre dupliquée en brouillon"); }}><Copy className="size-3.5" /> Dupliquer</Button>{service.active && <Button size="sm" variant="ghost" className="ml-auto text-red-300" onClick={() => { data.archiveService(service.id); toast.success("Offre archivée, historique conservé"); }}><Archive className="size-3.5" /> Archiver</Button>}</div>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        </>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Nouvelle offre" description="Les fourchettes servent de repère. Le prix exact sera fixé et modifiable sur chaque prestation.">
        <div className="grid gap-4">
          <Field label="Nom"><Input autoFocus value={form.name} onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))} /></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Type"><Select value={form.kind} onChange={(event) => setForm((state) => ({ ...state, kind: event.target.value as ServiceKind }))}><option value="formula">Formule</option><option value="option">Option</option><option value="subscription">Abonnement</option><option value="pack">Pack</option></Select></Field><Field label="Catégorie"><Input value={form.category} onChange={(event) => setForm((state) => ({ ...state, category: event.target.value }))} /></Field></div>
          <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
            <div><p className="text-sm font-bold text-violet-900">Fourchettes TTC par véhicule</p><p className="mt-1 text-xs text-violet-700">Indiquez le minimum et le maximum habituellement pratiqués pour chaque catégorie.</p></div>
            <div className="mt-4 grid gap-3">
              {priceFormats.map((format) => <div key={format} className="grid items-end gap-3 rounded-xl border border-violet-100 bg-white p-3 sm:grid-cols-[1fr_120px_120px]"><p className="self-center text-xs font-bold">{format}</p><Field label="Minimum (€)"><Input min="0" type="number" step="0.01" value={form.priceRanges[format]?.minimum ?? 0} onChange={(event) => setRange(format, "minimum", Number(event.target.value))} /></Field><Field label="Maximum (€)"><Input min={form.priceRanges[format]?.minimum ?? 0} type="number" step="0.01" value={form.priceRanges[format]?.maximum ?? 0} onChange={(event) => setRange(format, "maximum", Number(event.target.value))} /></Field></div>)}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Durée cible (h)"><Input min="0.25" type="number" step="0.25" value={form.durationHours} onChange={(event) => setForm((state) => ({ ...state, durationHours: Number(event.target.value) }))} /></Field><Field label="Coût produits (€)"><Input min="0" type="number" step="0.01" value={form.productEuros} onChange={(event) => setForm((state) => ({ ...state, productEuros: Number(event.target.value) }))} /></Field></div>
          <Button onClick={create}>Créer l’offre et ses fourchettes</Button>
        </div>
      </Modal>
    </div>
  );
}
