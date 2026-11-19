import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { qontoAutomationDecision } from "@/lib/domain/qonto-automation";
import { qontoContext } from "./qonto-context";
import { automaticBankMatches } from "@/lib/domain/banking";

export async function automateQonto(db: SupabaseClient, organizationId: string, from: string, deadline: number) {
  const stats = { services: 0, expenses: 0, matched: 0, ignored: 0, bankOnly: 0, pending: false };
  if (Date.now() >= deadline) return { ...stats, pending: true };
  const { error: repairError } = await db.rpc("repair_qonto_postings", { target_org: organizationId });
  if (repairError) throw new Error("Automatisation Qonto indisponible. Vérifiez la migration financière.");
  const context = await qontoContext(db, organizationId);
  const drafts = new Map(context.drafts.map((draft) => [draft.transaction.id, draft]));
  const cutoff = Date.parse(from);
  if (!Number.isFinite(cutoff)) throw new Error("Date de démarrage de l’automatisation indisponible. Vérifiez la migration Qonto.");
  const backlog = (id: string) => {
    const draft = drafts.get(id);
    return draft?.status === "pending" && draft.created_at === draft.updated_at;
  };
  const historical = new Map(automaticBankMatches(context.transactions, context.candidates.filter((c) => c.historicalEligible))
    .map(({ transaction, candidate }) => [transaction.id, candidate]));
  const eligible = context.transactions.filter((tx) => tx.reconciliation === "unmatched" && !tx.automated_at && tx.status === "completed"
    && tx.currency === "EUR" && tx.amount_cents > 0 && tx.settled_at && (Date.parse(tx.settled_at) >= cutoff || historical.has(tx.id) || backlog(tx.id) || (tx.posting_kind === "repost" && drafts.has(tx.id)))
    && new Date(tx.settled_at).getTime() <= Date.now() && !tx.reconciliation_group_id
    && (tx.posting_kind === "repost" || tx.posting_kind === "bank_only" || !drafts.has(tx.id) || backlog(tx.id)))
    .sort((a, b) => Number(a.posting_kind === "bank_only") - Number(b.posting_kind === "bank_only") || a.settled_at!.localeCompare(b.settled_at!) || a.id.localeCompare(b.id));
  let errors = 0;
  for (const tx of eligible) {
    if (Date.now() >= deadline) { stats.pending = true; break; }
    const prior = Date.parse(tx.settled_at!) < cutoff && !backlog(tx.id) && !(tx.posting_kind === "repost" && drafts.has(tx.id)) ? historical.get(tx.id) : undefined;
    const decision = qontoAutomationDecision(tx, context);
    if (prior && (decision.action !== "match" || decision.id !== prior.id || decision.kind !== prior.kind || decision.month !== prior.month)) continue;
    if (decision.action === "defer" && tx.posting_kind === "bank_only" && tx.automation_note === decision.reason) { stats.bankOnly++; continue; }
    const { data, error } = await db.rpc("post_qonto_transaction", {
      target_transaction: tx.id, expected_amount: tx.amount_cents, expected_settled_at: tx.settled_at,
      decision: { ...decision, ...(tx.remote_updated_at ? { version: tx.remote_updated_at } : {}), ...(decision.action === "match" && decision.month ? { month: `${decision.month}-01` } : {}) },
    });
    if (error) {
      // Do not turn a technical conflict into a fictitious sale or a successful run.
      errors++;
      continue;
    }
    if (data?.kind === "bank_only") stats.bankOnly++;
    else if (data?.kind === "service") stats.services++;
    else if (data?.kind === "expense") stats.expenses++;
    else if (data?.kind === "matched") stats.matched++;
    else if (data?.kind === "ignored") stats.ignored++;
  }
  if (errors) throw new Error(`Automatisation Qonto : ${errors} opération(s) seront retentées automatiquement. Les écritures validées sont conservées.`);
  return stats;
}
