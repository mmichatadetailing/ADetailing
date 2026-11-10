import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canManageBusiness, requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";
import { QontoClient, QontoRequestError } from "@/lib/integrations/qonto-client";
import { decryptToken } from "@/lib/integrations/token-crypto";
import type { QontoInvoiceFeed } from "@/lib/domain/qonto-invoices";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const credentials = z.object({ login: z.string().min(1), secret: z.string().min(1) });
const reply = (body: QontoInvoiceFeed | { error: string }, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

export async function GET(request: Request) {
  try {
    const db = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(db);
    if (!canManageBusiness(workspace.role)) return reply({ error: "Factures Qonto réservées aux associés et administrateurs." }, 403);
    const { data: connection, error } = await createSupabaseAdminClient().from("qonto_connections")
      .select("credentials_encrypted,enabled,remote_organization_id").eq("organization_id", workspace.organizationId).maybeSingle();
    if (error) return reply({ error: "Impossible de lire la connexion Qonto. Vérifiez la configuration dans Banque." }, 503);
    if (!connection?.credentials_encrypted) return reply({ state: "not_connected" });
    if (!connection.enabled) return reply({ state: "paused" });

    let access: z.infer<typeof credentials>;
    try { access = credentials.parse(JSON.parse(decryptToken(connection.credentials_encrypted))); }
    catch { return reply({ error: "Impossible d’utiliser la connexion Qonto. Vérifiez la clé de chiffrement ou reconnectez Qonto dans Banque." }, 503); }
    const invoices = await new QontoClient(access.login, access.secret).clientInvoices(connection.remote_organization_id, request.signal);
    return reply({ state: "ready", invoices, fetchedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof Error && error.message === "Authentification requise.") return reply({ error: "Reconnectez-vous pour consulter les factures Qonto." }, 401);
    if (error instanceof QontoRequestError && [401, 403].includes(error.status)) return reply({ error: "Qonto refuse l’accès aux factures clients. Vérifiez la connexion dans Banque et l’accès à la facturation sur votre compte Qonto." }, 502);
    if (error instanceof QontoRequestError && error.status === 429) return reply({ error: "Qonto limite temporairement les actualisations. Réessayez dans quelques minutes." }, 503);
    return reply({ error: "La liste des factures Qonto n’a pas pu être chargée entièrement. Réessayez dans un instant." }, 502);
  }
}
