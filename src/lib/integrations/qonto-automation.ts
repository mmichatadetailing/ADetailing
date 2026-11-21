import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canDeclareService, qontoAutomationDecision, type ServiceDeclaration } from "@/lib/domain/qonto-automation";
import { qontoContext } from "./qonto-context";
import { automaticBankMatches } from "@/lib/domain/banking";
import { isInternalLedgerHistory } from "@/lib/domain/ledger-history";

export async function declareQontoService(db: SupabaseClient, organizationId: string, actorId: string, input: ServiceDeclaration & {
  transactionId: string; expectedAmount: number; expectedSettledAt: string; expectedVersion: string; title: string;
}) {
  const context = await qontoContext(db, organizationId);
  const tx = context.transactions.find(t => t.id === input.transactionId);
  if (!tx) throw new Error("Transaction introuvable dans cette entreprise.");
  const existing = tx.reconciliation === "matched" && tx.side === "credit" && tx.payment_id && !tx.reconciliation_group_id;
  if (!existing && !canDeclareService(tx)) throw new Error("Ce mouvement ne peut pas être déclaré comme prestation.");
  const decision = existing ? { action: "existing" } as const : qontoAutomationDecision(tx, context, input);
  if (decision.action === "defer" || decision.action === "ignore") throw new Error(decision.reason);
  const { data, error } = await db.rpc("register_qonto_service_credit", {
    target_org: organizationId, target_transaction: tx.id, actor_id: actorId, expected_amount: input.expectedAmount,
    expected_settled_at: input.expectedSettledAt, expected_version: input.expectedVersion, decision: { ...decision, title: input.title },
  });
  if (error) throw new Error(error.code === "P0001" ? error.message : "Impossible d’enregistrer la prestation. Vérifiez que la migration Supabase 032 est appliquée puis actualisez le journal.");
  if (data?.kind === "bank_only") throw new Error(data.reason || "Un dossier existe déjà. Aucun nouvel encaissement créé.");
  if (!["existing","service","matched"].includes(data?.kind)) throw new Error("Ce crédit est indisponible ou déjà traité. Actualisez le journal.");
  return { kind: data.kind as "service" | "matched" | "existing", interventionId: data.interventionId as string | null };
}

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
    .filter(({transaction,candidate}) => !isInternalLedgerHistory(transaction.settled_at!) || candidate.kind === "payment" || candidate.recordedExpenseOccurrence)
    .map(({ transaction, candidate }) => [transaction.id, candidate]));
  const eligible = context.transactions.filter((tx) => tx.reconciliation === "unmatched" && !tx.automated_at && tx.status === "completed"
    && tx.currency === "EUR" && tx.amount_cents > 0 && tx.settled_at && (!isInternalLedgerHistory(tx.settled_at) || historical.has(tx.id) || tx.service_declared_by)
    && (Date.parse(tx.settled_at) >= cutoff || tx.service_declared_by || historical.has(tx.id) || backlog(tx.id) || (tx.posting_kind === "repost" && drafts.has(tx.id)))
    && new Date(tx.settled_at).getTime() <= Date.now() && !tx.reconciliation_group_id
    && (tx.posting_kind === "repost" || tx.posting_kind === "bank_only" || !drafts.has(tx.id) || backlog(tx.id)))
    .sort((a, b) => Number(a.posting_kind === "bank_only") - Number(b.posting_kind === "bank_only") || a.settled_at!.localeCompare(b.settled_at!) || a.id.localeCompare(b.id));
  let errors = 0;
  for (const tx of eligible) {
    if (Date.now() >= deadline) { stats.pending = true; break; }
    const prior = !tx.service_declared_by && (isInternalLedgerHistory(tx.settled_at!) || (Date.parse(tx.settled_at!) < cutoff && !backlog(tx.id) && !(tx.posting_kind === "repost" && drafts.has(tx.id)))) ? historical.get(tx.id) : undefined;
    const decision = qontoAutomationDecision(tx, context);
    if (prior && (decision.action !== "match" || decision.id !== prior.id || decision.kind !== prior.kind || decision.month !== prior.month)) continue;
    if (decision.action === "defer" && tx.posting_kind === "bank_only" && tx.automation_note === decision.reason) { stats.bankOnly++; continue; }
    const special = (decision.action === "service" || decision.action === "match") && tx.side === "credit"
      && (Boolean(tx.service_declared_by) || ((tx.attachment_count ?? 0) > 0 && !prior));
    const { data, error } = await db.rpc(special ? "register_qonto_service_credit" : "post_qonto_transaction", {
      ...(special ? { target_org: organizationId, expected_version: tx.remote_updated_at } : {}),
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
