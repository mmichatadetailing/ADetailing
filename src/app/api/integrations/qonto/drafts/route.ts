import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedWorkspace, canManageBusiness } from "@/lib/supabase/workspace";
import { bankDraftPayloadSchema } from "@/lib/domain/bank-drafts";
import { qontoContext } from "@/lib/integrations/qonto-context";

export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["dismiss", "restore"]), draftId: z.uuid(), expectedUpdatedAt: z.iso.datetime({ offset: true }) }),
  z.object({ action: z.literal("save"), draftId: z.uuid(), payload: bankDraftPayloadSchema, expectedUpdatedAt: z.iso.datetime({ offset: true }) }),
  z.object({ action: z.literal("validate"), draftId: z.uuid(), payload: bankDraftPayloadSchema, expectedUpdatedAt: z.iso.datetime({ offset: true }), expectedAmount: z.number().int().positive(), expectedSettledAt: z.iso.datetime({ offset: true }), targetKind: z.enum(["new", "payment", "expense", "intervention", "invoice", "maintenance"]), targetId: z.uuid().nullable().optional(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), confirmNew: z.boolean() }),
]);
async function access() {
  const db = await createSupabaseServerClient();
  const workspace = await requireAuthenticatedWorkspace(db);
  if (!canManageBusiness(workspace.role)) throw new Error("Accès réservé aux associés et administrateurs.");
  return { db, workspace };
}
function failure(error: unknown) {
  const message = error instanceof z.ZodError ? "Les informations du brouillon sont invalides." : error instanceof Error ? error.message : "Opération impossible.";
  return NextResponse.json({ error: message }, { status: message === "Authentification requise." ? 401 : message.startsWith("Accès réservé") ? 403 : 400 });
}
export async function GET(request: Request) {
  try {
    const { db, workspace } = await access();
    const params = new URL(request.url).searchParams;
    const side = params.get("side") === "debit" ? "debit" : "credit";
    const status = params.get("status") === "dismissed" ? "dismissed" : "pending";
    const page = Math.max(0, Number.parseInt(params.get("page") ?? "0", 10) || 0);
    const { data, error, count } = await db.from("bank_transaction_drafts").select("*,transaction:bank_transactions(*)", { count: "exact" }).eq("organization_id", workspace.organizationId).eq("side", side).eq("status", status).order("created_at", { ascending: false }).range(page * 20, (page + 1) * 20 - 1);
    if (error) throw new Error("Appliquez la migration Supabase des propositions automatiques Qonto.");
    const context = data?.length ? await qontoContext(db, workspace.organizationId) : { candidates: [] };
    return NextResponse.json({ drafts: data ?? [], total: count ?? 0, candidates: context.candidates }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const { db } = await access();
    const input = schema.parse(await request.json());
    const { action, draftId, ...details } = input;
    const normalizedDetails = "month" in details && details.month ? { ...details, month: `${details.month}-01` } : details;
    const { data, error } = await db.rpc("manage_bank_draft", { target_draft: draftId, action, details: normalizedDetails });
    if (error) throw new Error(error.message);
    return NextResponse.json(data ?? { ok: true });
  } catch (error) { return failure(error); }
}
