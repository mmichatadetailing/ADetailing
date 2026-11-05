import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncQonto } from "@/lib/integrations/qonto-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || secret.length < 32 || received.length !== expected.length || !timingSafeEqual(received, expected)) return NextResponse.json({ error: "Accès refusé." }, { status: 401 });
  const db = createSupabaseAdminClient();
  const { data, error } = await db.from("qonto_connections").select("organization_id").eq("enabled", true).order("updated_at").limit(10);
  if (error) return NextResponse.json({ error: "Configuration Qonto indisponible." }, { status: 503 });
  const started = Date.now();
  let synchronized = 0;
  let failed = 0;
  for (const connection of data ?? []) {
    if (Date.now() - started > 40_000) break;
    try { await syncQonto(db, String(connection.organization_id), Math.min(30_000, 45_000 - (Date.now() - started))); synchronized++; }
    catch { failed++; } // Le message détaillé est disponible seulement dans l’espace de l’entreprise.
  }
  return NextResponse.json({ synchronized, failed }, { status: failed ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
