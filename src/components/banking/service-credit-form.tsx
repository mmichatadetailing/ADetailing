"use client";

import { useRef, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useDemoStore } from "@/lib/demo/store";
import type { BankTransaction } from "@/lib/domain/banking";
import { servicePayer } from "@/lib/domain/qonto-automation";
import { formatDate, formatMoney } from "@/lib/utils";

export function ServiceCreditForm({ tx, historical, onClose, onSubmit }: {
  tx: BankTransaction; historical: boolean; onClose: () => void;
  onSubmit: (details: { title: string; clientId?: string; clientName?: string }) => Promise<void>;
}) {
  const clients = useDemoStore(s => s.clients);
  const [title, setTitle] = useState(tx.label.trim().slice(0,160) || "Prestation Qonto");
  const [choice, setChoice] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const payer = servicePayer(tx);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true; setBusy(true); setError("");
    try { await onSubmit({ title: title.trim(), ...(choice === "new" ? { clientName: name.trim() } : choice ? { clientId: choice } : {}) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { sending.current = false; setBusy(false); }
  };
  return <Modal open onClose={() => { if (!sending.current) onClose(); }} title="Déclarer une prestation"
    description={formatMoney(tx.amount_cents) + " · reçu le " + formatDate(tx.settled_at!)}>
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-sm text-zinc-600">Le logiciel recherche d’abord un règlement ou un dossier existant. Sinon, il crée une prestation terminée, déjà encaissée au montant et à la date du crédit.</p>
      {historical && <p className="rounded-xl border border-line p-3 text-sm">Ce crédit appartient à l’historique. Ne le déclarez pas s’il est déjà compris dans une saisie groupée.</p>}
      <Field label="Intitulé de la prestation"><Input required minLength={2} maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></Field>
      <Field label="Client"><Select value={choice} onChange={e => setChoice(e.target.value)}>
        <option value="">{payer ? "Déduire du virement · " + payer : "Identifier automatiquement, sinon laisser à identifier"}</option>
        <option value="new">Saisir un nom de client…</option>
        {clients.filter(c => !c.archivedAt).map(c => ({id:c.id, label:c.company || [c.firstName,c.lastName].filter(Boolean).join(" ")})).sort((a,b) => a.label.localeCompare(b.label,"fr")).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </Select></Field>
      {choice === "new" && <Field label="Nom du client"><Input required minLength={2} maxLength={150} value={name} onChange={e => setName(e.target.value)} /></Field>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onClose}>Annuler</Button>
        <Button type="submit" disabled={busy}>{busy && <LoaderCircle className="size-4 animate-spin" />}Créer ou rattacher la prestation</Button></div>
    </form>
  </Modal>;
}
