import { NextResponse } from "next/server";
import { z } from "zod";
import { listGoogleCalendars, refreshGoogleAccessToken, revokeGoogleRefreshToken } from "@/lib/integrations/google-calendar";
import { isGoogleCalendarConfigured } from "@/lib/integrations/google-oauth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";

const updateSchema = z.object({
  connectionId: z.string().uuid(),
  calendarId: z.string().trim().min(1).max(1024).nullable(),
  syncEnabled: z.boolean(),
});
const deleteSchema = z.object({ connectionId: z.string().uuid() });

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    if (!isGoogleCalendarConfigured()) return NextResponse.json({ configured: false, connections: [] });

    const { data: connections, error } = await supabase
      .from("google_calendar_connections")
      .select("id,google_account_email,encrypted_refresh_token,selected_calendar_ids,sync_enabled,last_synced_at")
      .eq("organization_id", workspace.organizationId)
      .eq("profile_id", workspace.user.id)
      .order("created_at");
    if (error) throw error;

    const result = await Promise.all((connections ?? []).map(async (connection) => {
      try {
        const calendars = await listGoogleCalendars(await refreshGoogleAccessToken(connection.encrypted_refresh_token));
        return {
          id: connection.id,
          email: connection.google_account_email,
          selected: Array.isArray(connection.selected_calendar_ids) ? connection.selected_calendar_ids : [],
          syncEnabled: connection.sync_enabled,
          lastSyncedAt: connection.last_synced_at,
          calendars,
        };
      } catch (cause) {
        return {
          id: connection.id,
          email: connection.google_account_email,
          selected: Array.isArray(connection.selected_calendar_ids) ? connection.selected_calendar_ids : [],
          syncEnabled: connection.sync_enabled,
          lastSyncedAt: connection.last_synced_at,
          calendars: [],
          error: cause instanceof Error ? cause.message : "Connexion Google expirée.",
        };
      }
    }));
    return NextResponse.json({ configured: true, connections: result });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Impossible de charger Google Calendar." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const input = updateSchema.parse(await request.json());
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    const { data: connection, error } = await supabase
      .from("google_calendar_connections")
      .select("id,encrypted_refresh_token")
      .eq("id", input.connectionId)
      .eq("organization_id", workspace.organizationId)
      .eq("profile_id", workspace.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!connection) return NextResponse.json({ error: "Connexion Google introuvable." }, { status: 404 });

    if (input.calendarId) {
      const calendars = await listGoogleCalendars(await refreshGoogleAccessToken(connection.encrypted_refresh_token));
      const selectedCalendar = calendars.find((calendar) => calendar.id === input.calendarId);
      if (!selectedCalendar) return NextResponse.json({ error: "Ce calendrier Google n’est plus disponible." }, { status: 409 });
      if (!["owner", "writer"].includes(selectedCalendar.accessRole ?? "")) {
        return NextResponse.json({ error: "Choisissez un calendrier sur lequel vous pouvez créer des événements." }, { status: 409 });
      }
    }

    const { error: updateError } = await supabase
      .from("google_calendar_connections")
      .update({ selected_calendar_ids: input.calendarId ? [input.calendarId] : [], sync_enabled: input.syncEnabled })
      .eq("id", connection.id)
      .eq("organization_id", workspace.organizationId)
      .eq("profile_id", workspace.user.id);
    if (updateError) throw updateError;
    return NextResponse.json({ success: true });
  } catch (cause) {
    if (cause instanceof z.ZodError) return NextResponse.json({ error: "Réglages Google Calendar invalides." }, { status: 400 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Enregistrement impossible." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const input = deleteSchema.parse(await request.json());
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    const { data: connection, error } = await supabase
      .from("google_calendar_connections")
      .select("id,encrypted_refresh_token")
      .eq("id", input.connectionId)
      .eq("organization_id", workspace.organizationId)
      .eq("profile_id", workspace.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!connection) return NextResponse.json({ error: "Connexion Google introuvable." }, { status: 404 });

    const revoked = await revokeGoogleRefreshToken(connection.encrypted_refresh_token).catch(() => false);
    const { error: deleteError } = await supabase
      .from("google_calendar_connections")
      .delete()
      .eq("id", connection.id)
      .eq("organization_id", workspace.organizationId)
      .eq("profile_id", workspace.user.id);
    if (deleteError) throw deleteError;
    return NextResponse.json({ success: true, revoked });
  } catch (cause) {
    if (cause instanceof z.ZodError) return NextResponse.json({ error: "Connexion Google invalide." }, { status: 400 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Déconnexion impossible." }, { status: 500 });
  }
}
