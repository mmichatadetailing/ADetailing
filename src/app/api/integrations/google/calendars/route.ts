import { NextResponse } from "next/server";
import { listGoogleCalendars, refreshGoogleAccessToken } from "@/lib/integrations/google-calendar";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    const { data: connections } = await supabase.from("google_calendar_connections").select("id,google_account_email,encrypted_refresh_token,selected_calendar_ids,last_synced_at").eq("profile_id", user.id);
    const result = await Promise.all((connections ?? []).map(async (connection) => ({ id: connection.id, email: connection.google_account_email, selected: connection.selected_calendar_ids, lastSyncedAt: connection.last_synced_at, calendars: await listGoogleCalendars(await refreshGoogleAccessToken(connection.encrypted_refresh_token)) })));
    return NextResponse.json({ connections: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Configuration Google incomplète" }, { status: 503 });
  }
}

