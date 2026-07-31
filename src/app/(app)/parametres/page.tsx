"use client";

import { CalendarDays, CheckCircle2, Database, KeyRound, RefreshCcw, Save, Settings2, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useDemoStore } from "@/lib/demo/store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const data = useDemoStore();
  const { mode, workspace, refresh } = useWorkspace();
  const [cashEuros, setCashEuros] = useState(data.settings.initialCash / 100);
  const [hourlyEuros, setHourlyEuros] = useState(data.settings.hourlyMarginTarget / 100);
  const [safetyEuros, setSafetyEuros] = useState(data.settings.cashSafetyBuffer / 100);
  const [sources, setSources] = useState(data.settings.leadSources.join("\n"));
  const [reasons, setReasons] = useState(data.settings.lostReasons.join("\n"));
  const [resetOpen, setResetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const supabaseReady = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const save = async () => {
    if (hourlyEuros < 0 || safetyEuros < 0) return toast.error("Les objectifs financiers ne peuvent pas être négatifs");
    const leadSources = [...new Set(sources.split("\n").map((item) => item.trim()).filter(Boolean))];
    const lostReasons = [...new Set(reasons.split("\n").map((item) => item.trim()).filter(Boolean))];
    if (leadSources.length === 0) return toast.error("Ajoutez au moins une source d’acquisition");
    const patch = { initialCash: Math.round(cashEuros * 100), hourlyMarginTarget: Math.round(hourlyEuros * 100), cashSafetyBuffer: Math.round(safetyEuros * 100), leadSources, lostReasons };
    if (mode === "demo" || !workspace) {
      data.updateSettings(patch);
      return toast.success("Paramètres enregistrés dans ce navigateur");
    }
    setSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: settingsError } = await supabase.from("app_settings").upsert([
        { organization_id: workspace.organizationId, location_id: workspace.locationId, key: "initial_cash_cents", value: patch.initialCash, updated_by: workspace.userId },
        { organization_id: workspace.organizationId, location_id: workspace.locationId, key: "hourly_margin_target_cents", value: patch.hourlyMarginTarget, updated_by: workspace.userId },
        { organization_id: workspace.organizationId, location_id: workspace.locationId, key: "cash_safety_buffer_cents", value: patch.cashSafetyBuffer, updated_by: workspace.userId },
        { organization_id: workspace.organizationId, location_id: workspace.locationId, key: "lost_reasons", value: patch.lostReasons, updated_by: workspace.userId },
      ], { onConflict: "organization_id,location_id,key" });
      if (settingsError) throw settingsError;
      const { data: existingSources, error: sourceReadError } = await supabase.from("lead_sources").select("id,name").eq("organization_id", workspace.organizationId);
      if (sourceReadError) throw sourceReadError;
      const existingNames = new Map((existingSources ?? []).map((source) => [source.name, source.id]));
      for (const source of existingSources ?? []) {
        if (!leadSources.includes(source.name)) {
          const { error } = await supabase.from("lead_sources").update({ active: false }).eq("id", source.id);
          if (error) throw error;
        }
      }
      for (const [index, source] of leadSources.entries()) {
        const existingId = existingNames.get(source);
        const query = existingId
          ? supabase.from("lead_sources").update({ active: true, display_order: index + 1 }).eq("id", existingId)
          : supabase.from("lead_sources").insert({ organization_id: workspace.organizationId, name: source, display_order: index + 1, active: true });
        const { error } = await query;
        if (error) throw error;
      }
      await refresh();
      toast.success("Paramètres enregistrés dans Supabase");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  };
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Configuration" title="Paramètres" description="Objectifs, référentiels et intégrations restent administrables sans modifier le code." actions={<Button onClick={() => void save()} disabled={saving}><Save className="size-4" /> {saving ? "Enregistrement…" : "Enregistrer"}</Button>} />
      <section className="grid gap-5 xl:grid-cols-[1fr_.9fr]"><Card><CardHeader><div><h2 className="flex items-center gap-2 font-bold"><Settings2 className="size-4 text-brand-400" /> Pilotage financier</h2><p className="mt-1 text-xs text-zinc-500">Valeurs utilisées dans les indicateurs de votre espace.</p></div></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><Field label="Trésorerie initiale (€)"><Input type="number" step="0.01" value={cashEuros} onChange={(event) => setCashEuros(Number(event.target.value))} /></Field><Field label="Marge de sécurité (€)"><Input min="0" type="number" step="0.01" value={safetyEuros} onChange={(event) => setSafetyEuros(Number(event.target.value))} /></Field><Field label="Objectif marge horaire (€)"><Input min="0" type="number" step="0.01" value={hourlyEuros} onChange={(event) => setHourlyEuros(Number(event.target.value))} /></Field><Field label="TVA standard (%)"><Input disabled value={data.settings.standardVatBasisPoints / 100} /></Field><Link href="/parametres/import" className="sm:col-span-2"><Button variant="secondary" className="w-full"><Database className="size-4" /> Ouvrir l’import historique XLSX</Button></Link></CardContent></Card><Card id="integrations"><CardHeader><div><h2 className="flex items-center gap-2 font-bold"><KeyRound className="size-4 text-sky-300" /> Intégrations</h2><p className="mt-1 text-xs text-zinc-500">Les secrets ne transitent jamais dans le frontend.</p></div></CardHeader><CardContent className="grid gap-3"><div className="flex items-start gap-3 rounded-xl border border-white/[0.07] p-4"><Database className="mt-0.5 size-4 text-emerald-300" /><div className="flex-1"><div className="flex items-center gap-2"><p className="text-xs font-bold">Supabase</p><Badge variant={supabaseReady ? "green" : "yellow"}>{supabaseReady ? "Configuré" : "Mode démo"}</Badge></div><p className="mt-2 text-[11px] leading-5 text-zinc-600">{supabaseReady ? "Authentification, données PostgreSQL et stockage privé actifs." : "Ajoutez NEXT_PUBLIC_SUPABASE_URL et la clé publiable dans .env.local."}</p></div></div><div className="flex items-start gap-3 rounded-xl border border-white/[0.07] p-4"><CalendarDays className="mt-0.5 size-4 text-sky-300" /><div className="flex-1"><div className="flex items-center gap-2"><p className="text-xs font-bold">Google Calendar</p><Badge variant="yellow">À configurer</Badge></div><p className="mt-2 text-[11px] leading-5 text-zinc-600">Chaque membre peut connecter son propre calendrier depuis sa session.</p><a href="/api/integrations/google/start"><Button size="sm" variant="secondary" className="mt-3"><CalendarDays className="size-3.5" /> Connecter ce compte</Button></a></div></div></CardContent></Card></section>
      <section className="grid gap-5 lg:grid-cols-2"><Card><CardHeader><div><h2 className="font-bold">Sources d’acquisition</h2><p className="mt-1 text-xs text-zinc-500">Une valeur par ligne.</p></div></CardHeader><CardContent><Textarea value={sources} onChange={(event) => setSources(event.target.value)} className="min-h-52" /></CardContent></Card><Card><CardHeader><div><h2 className="font-bold">Raisons de perte</h2><p className="mt-1 text-xs text-zinc-500">Une valeur par ligne.</p></div></CardHeader><CardContent><Textarea value={reasons} onChange={(event) => setReasons(event.target.value)} className="min-h-52" /></CardContent></Card></section>
      <Card><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 text-emerald-300" /><div><p className="text-sm font-bold">{mode === "supabase" ? "Données réelles protégées" : "Données de démonstration anonymisées"}</p><p className="mt-1 text-xs text-zinc-600">{mode === "supabase" ? "Vos enregistrements sont stockés dans Supabase et isolés par organisation grâce aux politiques RLS." : "Les modifications sont conservées dans ce navigateur. La réinitialisation est irréversible localement."}</p></div></div>{mode === "demo" && <Button variant="danger" onClick={() => setResetOpen(true)}><RefreshCcw className="size-4" /> Réinitialiser la démo</Button>}</CardContent></Card>
      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Réinitialiser les données ?" description="Toutes les saisies locales seront remplacées par les données anonymisées d’origine."><div className="rounded-xl border border-red-400/20 bg-red-400/[0.055] p-4"><p className="flex items-center gap-2 text-sm font-bold text-red-200"><TriangleAlert className="size-4" /> Cette action ne peut pas être annulée</p></div><div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setResetOpen(false)}>Annuler</Button><Button variant="danger" onClick={() => { data.resetDemo(); setResetOpen(false); toast.success("Données de démonstration réinitialisées"); }}><CheckCircle2 className="size-4" /> Confirmer</Button></div></Modal>
    </div>
  );
}
