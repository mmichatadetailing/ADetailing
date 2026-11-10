import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canManageBusiness, requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";
import { QontoClient } from "@/lib/integrations/qonto-client";
import { decryptToken } from "@/lib/integrations/token-crypto";

const credentials = z.object({ login: z.string().min(1), secret: z.string().min(1) });

export class QontoInvoiceAccessError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function getQontoInvoiceAccess() {
  const db = await createSupabaseServerClient();
  const workspace = await requireAuthenticatedWorkspace(db).catch((error: unknown) => {
    if (error instanceof Error && error.message === "Authentification requise.") {
      throw new QontoInvoiceAccessError(401, "Reconnectez-vous pour consulter les factures Qonto.");
    }
    throw error;
  });
  if (!canManageBusiness(workspace.role)) throw new QontoInvoiceAccessError(403, "Factures Qonto réservées aux associés et administrateurs.");

  const { data: connection, error } = await createSupabaseAdminClient().from("qonto_connections")
    .select("credentials_encrypted,enabled,remote_organization_id").eq("organization_id", workspace.organizationId).maybeSingle();
  if (error) throw new QontoInvoiceAccessError(503, "Impossible de lire la connexion Qonto. Vérifiez la configuration dans Banque.");
  if (!connection?.credentials_encrypted) return { state: "not_connected" } as const;
  if (!connection.enabled) return { state: "paused" } as const;

  let access: z.infer<typeof credentials>;
  try { access = credentials.parse(JSON.parse(decryptToken(connection.credentials_encrypted))); }
  catch { throw new QontoInvoiceAccessError(503, "Impossible d’utiliser la connexion Qonto. Vérifiez la clé de chiffrement ou reconnectez Qonto dans Banque."); }
  return { state: "ready", client: new QontoClient(access.login, access.secret), organizationId: connection.remote_organization_id } as const;
}
