import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken } from "./token-crypto";
import { QontoClient, type QontoAccount } from "./qonto-client";
import { qontoContext } from "./qonto-context";
import { automaticBankMatches, bankDate } from "@/lib/domain/banking";

export async function syncQonto(db: SupabaseClient, organizationId: string, budgetMs = 35_000) {
  const started = Date.now();
  const token = randomUUID();
  const { data: connection, error: acquireError } = await db.from("qonto_connections")
    .update({ lease_token: token, lease_until: new Date(Date.now() + 120_000).toISOString() })
    .eq("organization_id", organizationId).eq("enabled", true)
    .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).select("*").maybeSingle();
  if (acquireError) throw new Error("Synchronisation bancaire indisponible. Appliquez la migration Qonto.");
  if (!connection) return { imported: 0, reconciled: 0, busy: true, pending: false };
  let imported = 0;
  let reconciled = 0;
  try {
    const { login, secret } = JSON.parse(decryptToken(String(connection.credentials_encrypted))) as { login: string; secret: string };
    const client = new QontoClient(login, secret);
    const accounts = connection.accounts as QontoAccount[];
    let cursor = String(connection.cursor_at);
    let until = connection.window_to ? String(connection.window_to) : new Date(Math.min(Date.now(), new Date(cursor).getTime() + 7 * 86_400_000)).toISOString();
    let accountIndex = Number(connection.account_index);
    let page = Number(connection.next_page);
    let pending = true;
    let pages = 0;
    while (Date.now() - started < budgetMs && pages < 12 && pending) {
      const account = accounts[accountIndex];
      if (!account) throw new Error("Aucun compte Qonto EUR n’est configuré.");
      const result = await client.transactions(account, cursor, until, page);
      if (result.meta.total_pages > 100) throw new Error("Trop de transactions dans cette fenêtre Qonto. Réduisez la période d’import avec le support.");
      const entries = result.transactions.filter((tx) => bankDate(tx.settled_at ?? tx.emitted_at) >= String(connection.import_since)).map((tx) => ({
        remote_id: tx.id, remote_organization_id: connection.remote_organization_id, account_id: account.id, account_name: account.name,
        label: (tx.label ?? "").slice(0, 500), counterparty: (tx.clean_counterparty_name ?? "").slice(0, 300), reference: (tx.reference ?? "").slice(0, 500),
        amount_cents: tx.amount_cents, currency: tx.currency, side: tx.side, status: tx.status,
        settled_at: tx.settled_at, emitted_at: tx.emitted_at, remote_updated_at: tx.updated_at,
        operation_type: tx.transfer?.counterparty_account_number && accounts.some((owned) => owned.iban.replace(/\s/g, "") === tx.transfer!.counterparty_account_number!.replace(/\s/g, "")) ? "internal_transfer" : tx.operation_type,
      }));
      const { error: ingestError } = await db.rpc("ingest_qonto_transactions", { target_org: organizationId, entries });
      if (ingestError) throw new Error("L’import Qonto n’a pas pu être enregistré. Aucun paiement supplémentaire n’a été créé.");
      imported += entries.length;
      pages += 1;
      if (result.meta.next_page) page = result.meta.next_page;
      else { accountIndex += 1; page = 1; }
      if (accountIndex >= accounts.length) {
        accountIndex = 0;
        const completedUntil = until;
        pending = new Date(completedUntil).getTime() < Date.now() - 60_000;
        // Une reprise de 48 h rattrape les modifications arrivées pendant la pagination.
        cursor = pending ? completedUntil : new Date(Math.max(new Date(`${connection.import_since}T00:00:00Z`).getTime(), new Date(completedUntil).getTime() - 2 * 86_400_000)).toISOString();
        until = pending ? new Date(Math.min(Date.now(), new Date(cursor).getTime() + 7 * 86_400_000)).toISOString() : "";
      }
      const { error: checkpointError } = await db.from("qonto_connections").update({ cursor_at: cursor, window_to: until || null, account_index: accountIndex, next_page: page, last_error: null, updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("lease_token", token);
      if (checkpointError) throw new Error("La progression de synchronisation n’a pas pu être enregistrée. Le prochain essai reprendra sans doublon.");
    }
    const { data: currentSettings } = await db.from("qonto_connections").select("enabled,auto_reconcile").eq("organization_id", organizationId).maybeSingle();
    if (currentSettings?.enabled && currentSettings.auto_reconcile && Date.now() - started < budgetMs) {
      const { transactions, candidates } = await qontoContext(db, organizationId);
      for (const match of automaticBankMatches(transactions, candidates)) {
        if (Date.now() - started >= budgetMs) break;
        const { error } = await db.rpc("reconcile_bank_transaction", { target_transaction: match.transaction.id, target_kind: match.candidate.kind, target_id: match.candidate.id, target_month: match.candidate.month ? `${match.candidate.month}-01` : null });
        if (!error) reconciled += 1; // Une concurrence laisse l’opération à vérifier, jamais à dupliquer.
      }
    }
    await db.from("qonto_connections").update({ last_synced_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("lease_token", token);
    return { imported, reconciled, busy: false, pending };
  } catch (error) {
    const message = error instanceof Error && !error.message.includes("decrypt") && !error.message.includes("authenticate")
      ? error.message : "La clé de chiffrement ou les identifiants Qonto ne sont pas valides. Reconnectez Qonto.";
    await db.from("qonto_connections").update({ last_error: message.slice(0, 300), updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("lease_token", token);
    throw new Error(message);
  } finally {
    await db.from("qonto_connections").update({ lease_token: null, lease_until: null }).eq("organization_id", organizationId).eq("lease_token", token);
  }
}
