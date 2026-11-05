"use client";

import { Download, FileSpreadsheet, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { useDemoStore } from "@/lib/demo/store";
import { waitForWorkspaceMutations } from "@/lib/supabase/sync";

export function DataExport({ compact = false }: { compact?: boolean }) {
  const { mode, workspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (mode !== "demo" && !workspace?.canManageBusiness) return null;

  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await waitForWorkspaceMutations();
      let blob: Blob;
      if (mode === "demo") {
        const { exportWorkspaceExcel } = await import("@/lib/export/workbook");
        const buffer = await exportWorkspaceExcel(useDemoStore.getState());
        blob = new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      } else {
        const response = await fetch("/api/exports/excel", { cache: "no-store" });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(payload.error ?? "L’export n’a pas pu être préparé. Réessayez.");
        }
        blob = await response.blob();
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ADetailing-export-${new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date())}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setOpen(false);
      toast.success("Export Excel téléchargé");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Export impossible."); }
    finally { setBusy(false); }
  };
  return <>
    <Button variant="secondary" size={compact ? "icon" : "md"} onClick={() => setOpen(true)} aria-label="Exporter les données Excel" title="Exporter les données Excel"><FileSpreadsheet className="size-4" />{!compact && "Exporter les données Excel"}</Button>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title="Exporter les données Excel" description="Un seul fichier, organisé par activité, pour consulter et analyser vos données.">
      <div className="space-y-4 text-sm text-zinc-600"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-bold text-emerald-900">{workspace?.organizationName ?? "Données de démonstration"}</p><p className="mt-2 text-xs leading-6">Synthèse et bilan mensuel, clients, véhicules, prestations et affectations, entretiens et échéances, paiements, charges, équipe, catalogue, objectifs, documents et historique accessible.</p></div><p className="text-xs leading-6">Toutes les périodes disponibles sont exportées. Les tableaux sont filtrables, avec des dates triables et des montants en euros. Les forfaits prépayés ne sont pas comptés une seconde fois sur chaque visite.</p><p className="rounded-xl bg-orange-50 p-3 text-xs leading-5 text-orange-900">Ce fichier contient des données confidentielles. Il n’inclut ni les fichiers PDF/photos ni les événements Google, et ne remplace pas une sauvegarde complète de la base.</p><div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Annuler</Button><Button disabled={busy} onClick={() => void download()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}{busy ? "Préparation de l’export…" : "Télécharger le fichier Excel"}</Button></div></div>
    </Modal>
  </>;
}
