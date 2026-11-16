import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { qontoAutomationDecision } from "@/lib/domain/qonto-automation";
import { qontoContext } from "./qonto-context";

export async function automateQonto(db: SupabaseClient, organizationId: string, from: string, deadline: number) {
  const context = await qontoContext(db, organizationId);
  const stats = { services: 0, expenses: 0, matched: 0, ignored: 0, review: 0, pending: false };
  const drafts = new Map(context.drafts.map((draft) => [draft.transaction.id, draft]));
  const eligible = context.transactions.filter((tx) => tx.reconciliation === "unmatched" && !tx.automated_at && tx.status === "completed"
    && tx.currency === "EUR" && tx.amount_cents > 0 && tx.settled_at && new Date(tx.settled_at).getTime() >= new Date(from).getTime()
    && new Date(tx.settled_at).getTime() <= Date.now() && !tx.reconciliation_group_id
    && (!drafts.has(tx.id) || (drafts.get(tx.id)!.status === "pending" && drafts.get(tx.id)!.updated_at === drafts.get(tx.id)!.created_at)))
    .sort((a, b) => a.settled_at!.localeCompare(b.settled_at!) || a.id.localeCompare(b.id));
  for (const tx of eligible) {
    if (Date.now() >= deadline) { stats.pending = true; break; }
    const decision = qontoAutomationDecision(tx, context);
    if (decision.action === "review" && tx.automation_note === decision.reason) { stats.review++; continue; }
    const { data, error } = await db.rpc("automate_qonto_transaction", {
      target_transaction: tx.id, expected_amount: tx.amount_cents, expected_settled_at: tx.settled_at,
      decision: decision.action === "match" ? { ...decision, month: decision.month ? `${decision.month}-01` : null } : decision,
    });
    if (error) {
      // One conflict must not stop other operations, nor trigger a fallback creation.
      const { error: reportError } = await db.rpc("automate_qonto_transaction", {
        target_transaction: tx.id, expected_amount: tx.amount_cents, expected_settled_at: tx.settled_at,
        decision: { action: "review", reason: "L’intégration n’a pas abouti. Vérifiez la correspondance ou relancez la synchronisation." },
      });
      if (reportError) throw new Error("Automatisation Qonto indisponible. Vérifiez la migration et relancez la synchronisation ; les mouvements déjà intégrés sont conservés.");
      stats.review++;
      continue;
    }
    if (data?.review) stats.review++;
    else if (data?.kind === "service") stats.services++;
    else if (data?.kind === "expense") stats.expenses++;
    else if (data?.kind === "matched") stats.matched++;
    else if (data?.kind === "ignored") stats.ignored++;
  }
  return stats;
}
