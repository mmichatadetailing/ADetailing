import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canManageBusiness, requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";
import { QontoClient } from "./qonto-client";
import { decryptToken } from "./token-crypto";

const credentials = z.object({ login: z.string().min(1), secret: z.string().min(1) });
export class QontoReadAccessError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function getQontoReadAccess(resource: string) {
  const db = await createSupabaseServerClient();
  const workspace = await requireAuthenticatedWorkspace(db).catch((error: unknown) => {
    if (error instanceof Error && error.message === "Authentification requise.") {
      throw new QontoReadAccessError(401, `Reconnectez-vous pour consulter ${resource}.`);
    }
    throw error;
  });
  if (!canManageBusiness(workspace.role)) throw new QontoReadAccessError(403, "Consultation Qonto réservée aux associés et administrateurs.");
  const { data: connection, error } = await createSupabaseAdminClient().from("qonto_connections")
    .select("credentials_encrypted,enabled,remote_organization_id").eq("organization_id", workspace.organizationId).maybeSingle();
  if (error) throw new QontoReadAccessError(503, "Impossible de lire la connexion Qonto. Vérifiez la configuration dans Banque.");
  if (!connection?.credentials_encrypted) return { state: "not_connected" } as const;
  if (!connection.enabled) return { state: "paused" } as const;
  let access: z.infer<typeof credentials>;
  try { access = credentials.parse(JSON.parse(decryptToken(connection.credentials_encrypted))); }
  catch { throw new QontoReadAccessError(503, "Impossible d’utiliser la connexion Qonto. Vérifiez la clé de chiffrement ou reconnectez Qonto dans Banque."); }
  return { state: "ready", client: new QontoClient(access.login, access.secret), organizationId: String(connection.remote_organization_id) } as const;
}
