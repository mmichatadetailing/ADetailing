import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedWorkspace, canManageBusiness } from "@/lib/supabase/workspace";
import { encryptToken, tokenEncryptionKeyStatus } from "@/lib/integrations/token-crypto";
import { QontoClient } from "@/lib/integrations/qonto-client";
import { qontoContext } from "@/lib/integrations/qonto-context";
import { syncQonto } from "@/lib/integrations/qonto-sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), login: z.string().trim().min(2).max(200).regex(/^[a-zA-Z0-9_-]+$/), secret: z.string().trim().min(8).max(500).regex(/^[^\r\n:]+$/), importSince: z.iso.date(), autoReconcile: z.boolean() }),
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("settings"), enabled: z.boolean(), autoReconcile: z.boolean() }),
  z.object({ action: z.literal("disconnect") }),
  z.object({ action: z.literal("reconcile"), transactionId: z.uuid(), kind: z.enum(["payment", "expense", "new_expense", "intervention", "invoice", "maintenance", "ignore", "undo"]), targetId: z.uuid().nullable().optional(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().optional(), description: z.string().trim().max(300).optional(), category: z.string().trim().max(120).optional(), reason: z.string().trim().max(500).optional() }),
]);

async function access() {
  const db = await createSupabaseServerClient();
  const workspace = await requireAuthenticatedWorkspace(db);
  if (!canManageBusiness(workspace.role)) throw new Error("Accès bancaire réservé aux associés et administrateurs.");
  return { db, workspace };
}
function failure(error: unknown) {
  const message = error instanceof z.ZodError ? "Les informations saisies sont invalides." : error instanceof Error ? error.message : "Opération Qonto impossible.";
  return NextResponse.json({ error: message }, { status: message === "Authentification requise." ? 401 : message.startsWith("Accès bancaire") ? 403 : 400 });
}
export async function GET(request: Request) {
  try {
    const { db, workspace } = await access();
    const admin = createSupabaseAdminClient();
    const { data: connection, error } = await admin.from("qonto_connections").select("organization_name,accounts,import_since,enabled,auto_reconcile,last_synced_at,last_error,window_to,credentials_encrypted,lease_until").eq("organization_id", workspace.organizationId).maybeSingle();
    if (error) throw new Error("Appliquez la migration Supabase Qonto avant de connecter votre compte.");
    const context = await qontoContext(db, workspace.organizationId);
    const params = new URL(request.url).searchParams;
    const filter = params.get("filter") ?? "unmatched";
    const page = Math.max(0, Number(params.get("page")) || 0);
    const filtered = context.transactions.filter((tx) => filter === "all" || tx.reconciliation === filter).sort((a, b) => (b.settled_at ?? b.emitted_at).localeCompare(a.settled_at ?? a.emitted_at));
    const { credentials_encrypted: encrypted, accounts, ...publicConnection } = connection ?? {};
    return NextResponse.json({ connection: connection ? { ...publicConnection, connected: Boolean(encrypted), accounts: (accounts as Array<{ name: string; iban: string }>).map((account) => ({ name: account.name, last4: account.iban.slice(-4) })) } : null,
      transactions: filtered.slice(page * 50, (page + 1) * 50), total: filtered.length, candidates: context.candidates,
      counts: Object.fromEntries(["unmatched", "matched", "ignored", "review"].map((state) => [state, context.transactions.filter((tx) => tx.reconciliation === state).length])),
      configured: tokenEncryptionKeyStatus() === "valid", cronConfigured: Boolean(process.env.CRON_SECRET),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const { db, workspace } = await access();
    const input = schema.parse(await request.json());
    if (input.action === "reconcile") {
      const { error } = await db.rpc("reconcile_bank_transaction", { target_transaction: input.transactionId, target_kind: input.kind, target_id: input.targetId ?? null, target_month: input.month ? `${input.month}-01` : null, details: { description: input.description, category: input.category, reason: input.reason } });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }
    const admin = createSupabaseAdminClient();
    if (input.action === "sync") return NextResponse.json(await syncQonto(admin, workspace.organizationId));
    if (input.action === "connect") {
      if (tokenEncryptionKeyStatus() !== "valid") throw new Error("Configurez OAUTH_TOKEN_ENCRYPTION_KEY dans Vercel avant de connecter Qonto.");
      if (new Date(input.importSince).getTime() > Date.now()) throw new Error("La date de début d’import ne peut pas être dans le futur.");
      const remote = await new QontoClient(input.login, input.secret).organization();
      if (!remote.accounts.length) throw new Error("Aucun compte Qonto en euros n’a été trouvé.");
      const { data: existing, error: readError } = await admin.from("qonto_connections").select("*").eq("organization_id", workspace.organizationId).maybeSingle();
      if (readError) throw new Error("Appliquez la migration Supabase Qonto.");
      if (existing && existing.remote_organization_id !== remote.id) throw new Error("Ce logiciel est déjà relié à une autre entreprise Qonto. Son historique ne peut pas être mélangé.");
      if (existing?.lease_until && new Date(existing.lease_until) > new Date()) throw new Error("Une synchronisation est en cours. Attendez sa fin avant de reconnecter Qonto.");
      const importSince = existing && String(existing.import_since) < input.importSince ? String(existing.import_since) : input.importSince;
      const oldAccounts = (existing?.accounts ?? []) as Array<{ id: string }>;
      const reset = !existing || importSince < String(existing.import_since) || JSON.stringify(oldAccounts.map((account) => account.id)) !== JSON.stringify(remote.accounts.map((account) => account.id));
      const { error } = await admin.from("qonto_connections").upsert({ organization_id: workspace.organizationId, location_id: workspace.locationId, remote_organization_id: remote.id, organization_name: remote.name, credentials_encrypted: encryptToken(JSON.stringify({ login: input.login, secret: input.secret })), accounts: remote.accounts, import_since: importSince, enabled: true, auto_reconcile: input.autoReconcile, cursor_at: reset ? `${importSince}T00:00:00Z` : existing.cursor_at, window_to: reset ? null : existing.window_to, account_index: reset ? 0 : existing.account_index, next_page: reset ? 1 : existing.next_page, created_by: workspace.user.id, last_error: null, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
      if (error) throw new Error("La connexion Qonto n’a pas pu être enregistrée.");
      return NextResponse.json({ ok: true });
    }
    const patch = input.action === "disconnect" ? { enabled: false, credentials_encrypted: "", updated_at: new Date().toISOString() } : { enabled: input.enabled, auto_reconcile: input.autoReconcile, updated_at: new Date().toISOString() };
    const { error } = await admin.from("qonto_connections").update(patch).eq("organization_id", workspace.organizationId);
    if (error) throw new Error("Les paramètres Qonto n’ont pas pu être enregistrés.");
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
}
