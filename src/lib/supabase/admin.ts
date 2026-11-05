import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configurez SUPABASE_SERVICE_ROLE_KEY côté serveur pour la synchronisation bancaire.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
