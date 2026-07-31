"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, FileSpreadsheet, LoaderCircle, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useDemoStore } from "@/lib/demo/store";
import type { HistoricalImportPreview } from "@/lib/import/xlsx-importer";

export default function HistoricalImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const applyPreview = useDemoStore((state) => state.applyHistoricalPreview);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<HistoricalImportPreview | null>(null);
  const [report, setReport] = useState<{ created: number; skipped: number; warnings: number } | null>(null);
  const upload = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/imports/xlsx", { method: "POST", body: form });
      const payload = await response.json() as HistoricalImportPreview | { error: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Prévisualisation impossible");
      setPreview(payload); toast.success("Classeur analysé — aucune donnée encore modifiée");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Import impossible"); }
    finally { setLoading(false); if (inputRef.current) inputRef.current.value = ""; }
  };
  return <div className="space-y-7"><PageHeader eyebrow="Administration" title="Import historique XLSX" description="Prévisualisez les correspondances, erreurs et doublons avant toute écriture. Relancer le même fichier ne recrée pas les lignes portant le même legacy_row." actions={<Link href="/parametres"><Button variant="ghost"><ArrowLeft className="size-4" /> Paramètres</Button></Link>} /><input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(event) => upload(event.target.files?.[0])} />
    {!preview ? <Card><CardContent className="p-5"><button disabled={loading} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); upload(event.dataTransfer.files[0]); }} className="focus-ring grid min-h-[330px] w-full place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.018] p-10 text-center hover:border-brand-400/30"><span>{loading ? <LoaderCircle className="mx-auto size-10 animate-spin text-brand-400" /> : <FileSpreadsheet className="mx-auto size-10 text-emerald-300" />}<span className="mt-5 block text-sm font-bold">{loading ? "Analyse du classeur…" : "Déposer ADetailing Pilotage.xlsx"}</span><span className="mt-2 block text-xs leading-5 text-zinc-600">Dashboard et Synthèses seront ignorés.<br />25 Mo maximum.</span></span></button></CardContent></Card> : <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">{Object.entries(preview.totals).map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-[10px] font-bold tracking-wider text-zinc-600 uppercase">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></CardContent></Card>)}</section>
      <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><Card><CardHeader><div><h2 className="font-bold">Onglets détectés</h2><p className="mt-1 text-xs text-zinc-500">Les agrégats restent des snapshots, pas des événements calendrier.</p></div></CardHeader><CardContent className="grid gap-2">{preview.sheets.map((sheet) => <div key={sheet.name} className="flex items-center gap-3 rounded-xl border border-white/[0.06] p-3"><FileSpreadsheet className="size-4 text-emerald-300" /><div className="flex-1"><p className="text-xs font-semibold">{sheet.name}</p><p className="mt-1 text-[10px] text-zinc-600">{sheet.detectedKind}</p></div><Badge>{sheet.rows} lignes</Badge></div>)}</CardContent></Card><div className="grid gap-5"><Card><CardHeader><div><h2 className="font-bold">Qualité des données</h2></div></CardHeader><CardContent className="grid gap-3"><div className="flex items-center gap-3 rounded-xl bg-amber-400/[0.05] p-3"><AlertTriangle className="size-4 text-amber-300" /><span className="text-xs">{preview.errors.length} erreur(s) de format</span></div><div className="flex items-center gap-3 rounded-xl bg-sky-400/[0.05] p-3"><UsersRound className="size-4 text-sky-300" /><span className="text-xs">{preview.duplicateCandidates.length} doublon(s) potentiel(s)</span></div>{preview.duplicateCandidates.slice(0, 3).map((candidate) => <p key={`${candidate.reason}-${candidate.value}`} className="text-[11px] text-zinc-600">{candidate.reason} · lignes {candidate.rows.join(", ")}</p>)}</CardContent></Card><Card><CardContent className="p-5"><p className="text-xs leading-5 text-zinc-500">Empreinte SHA-256 : <span className="font-mono text-[10px] text-zinc-600">{preview.fileHash.slice(0, 20)}…</span></p><div className="mt-4 grid gap-2"><Button onClick={() => setReport(applyPreview(preview))}><CheckCircle2 className="size-4" /> Appliquer l’import</Button><Button variant="ghost" onClick={() => setPreview(null)}>Choisir un autre fichier</Button></div></CardContent></Card></div></div>
      {preview.errors.length > 0 && <Card><CardHeader><h2 className="font-bold">Lignes à vérifier</h2></CardHeader><CardContent className="overflow-x-auto px-0 pb-1"><table className="w-full min-w-[600px] text-left text-xs"><thead className="text-zinc-600"><tr><th className="px-5 py-3">Onglet</th><th className="px-3 py-3">Ligne</th><th className="px-3 py-3">Champ</th><th className="px-5 py-3">Erreur</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{preview.errors.slice(0, 50).map((error, index) => <tr key={`${error.sheet}-${error.row}-${index}`}><td className="px-5 py-3">{error.sheet}</td><td className="px-3 py-3">{error.row}</td><td className="px-3 py-3">{error.field}</td><td className="px-5 py-3 text-amber-200">{error.message}</td></tr>)}</tbody></table></CardContent></Card>}
    </>}
    <Modal open={Boolean(report)} onClose={() => setReport(null)} title="Rapport d’import" description="Les lignes idempotentes ont été ignorées.">{report && <div className="grid gap-3 sm:grid-cols-3">{[["Créés", report.created, "green"], ["Ignorés", report.skipped, "neutral"], ["À vérifier", report.warnings, "yellow"]].map(([label, value, variant]) => <div key={String(label)} className="rounded-xl border border-white/[0.07] p-4 text-center"><Badge variant={variant as "green" | "neutral" | "yellow"}>{label}</Badge><p className="mt-3 text-2xl font-bold">{value}</p></div>)}</div>}</Modal>
  </div>;
}
