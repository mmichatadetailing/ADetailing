import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteGoogleEvent, refreshGoogleAccessToken, upsertGoogleEvent } from "@/lib/integrations/google-calendar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";

const inputSchema = z.object({ connectionId: z.string().uuid().optional() });
const syncedStatuses = new Set(["scheduled", "confirmed", "in_progress", "completed"]);

type CalendarConnection = {
  id: string;
  encrypted_refresh_token: string;
  selected_calendar_ids: unknown;
  sync_enabled: boolean;
};

type InterventionRow = {
  id: string;
  client_id: string;
  title: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  planned_duration_minutes: number | null;
  address: string | null;
  notes: string | null;
  updated_at: string;
};

type MappingRow = {
  id: string;
  intervention_id: string | null;
  google_calendar_id: string;
  google_event_id: string;
  last_internal_version: string | null;
  sync_status: string;
};

function selectedCalendarIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function clientLabel(client: { kind: string; company: string | null; first_name: string | null; last_name: string | null } | undefined) {
  if (!client) return "Client non renseigné";
  if (client.kind === "business" && client.company) return client.company;
  return [client.first_name, client.last_name].filter(Boolean).join(" ") || client.company || "Client non renseigné";
}

export async function POST(request: Request) {
  try {
    const rawInput = await request.json().catch(() => ({}));
    const input = inputSchema.parse(rawInput);
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);

    let connectionQuery = supabase
      .from("google_calendar_connections")
      .select("id,encrypted_refresh_token,selected_calendar_ids,sync_enabled")
      .eq("organization_id", workspace.organizationId)
      .eq("profile_id", workspace.user.id);
    if (input.connectionId) connectionQuery = connectionQuery.eq("id", input.connectionId);
    const { data: connectionData, error: connectionError } = await connectionQuery;
    if (connectionError) throw connectionError;
    const connections = (connectionData ?? []) as CalendarConnection[];

    const { data: workerRows, error: workerError } = await supabase
      .from("intervention_workers")
      .select("intervention_id")
      .eq("organization_id", workspace.organizationId)
      .eq("profile_id", workspace.user.id);
    if (workerError) throw workerError;
    const interventionIds = [...new Set((workerRows ?? []).map((row) => row.intervention_id as string))];

    let interventions: InterventionRow[] = [];
    if (interventionIds.length > 0) {
      const { data, error } = await supabase
        .from("interventions")
        .select("id,client_id,title,status,start_at,end_at,planned_duration_minutes,address,notes,updated_at")
        .eq("organization_id", workspace.organizationId)
        .in("id", interventionIds)
        .is("archived_at", null);
      if (error) throw error;
      interventions = (data ?? []) as InterventionRow[];
    }

    const clientIds = [...new Set(interventions.map((intervention) => intervention.client_id))];
    const clientsById = new Map<string, { kind: string; company: string | null; first_name: string | null; last_name: string | null }>();
    if (clientIds.length > 0) {
      const { data, error } = await supabase
        .from("clients")
        .select("id,kind,company,first_name,last_name")
        .eq("organization_id", workspace.organizationId)
        .in("id", clientIds);
      if (error) throw error;
      for (const client of data ?? []) clientsById.set(client.id, client);
    }

    const totals = { created: 0, updated: 0, removed: 0, unchanged: 0, skippedConnections: 0, errors: [] as string[] };
    for (const connection of connections) {
      const calendarIds = selectedCalendarIds(connection.selected_calendar_ids).slice(0, 1);
      if (!connection.sync_enabled || calendarIds.length === 0) {
        totals.skippedConnections += 1;
        continue;
      }

      try {
        const accessToken = await refreshGoogleAccessToken(connection.encrypted_refresh_token);
        const { data: mappingData, error: mappingError } = await supabase
          .from("calendar_event_mappings")
          .select("id,intervention_id,google_calendar_id,google_event_id,last_internal_version,sync_status")
          .eq("organization_id", workspace.organizationId)
          .eq("connection_id", connection.id)
          .not("intervention_id", "is", null);
        if (mappingError) throw mappingError;
        const mappings = (mappingData ?? []) as MappingRow[];

        const eligibleInterventions = interventions.filter((intervention) => (
          syncedStatuses.has(intervention.status) && Boolean(intervention.start_at)
        ));
        const eligibleKeys = new Set(eligibleInterventions.flatMap((intervention) => calendarIds.map((calendarId) => `${intervention.id}:${calendarId}`)));

        for (const mapping of mappings) {
          const key = `${mapping.intervention_id}:${mapping.google_calendar_id}`;
          if (eligibleKeys.has(key)) continue;
          await deleteGoogleEvent(accessToken, mapping.google_calendar_id, mapping.google_event_id);
          const { error } = await supabase.from("calendar_event_mappings").delete().eq("id", mapping.id).eq("connection_id", connection.id);
          if (error) throw error;
          totals.removed += 1;
        }

        for (const intervention of eligibleInterventions) {
          const startAt = intervention.start_at!;
          const endAt = intervention.end_at ?? new Date(new Date(startAt).getTime() + Math.max(15, intervention.planned_duration_minutes ?? 60) * 60_000).toISOString();
          const client = clientLabel(clientsById.get(intervention.client_id));
          const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
          const description = [
            `Client : ${client}`,
            intervention.notes?.trim() ? `Notes : ${intervention.notes.trim()}` : null,
            appUrl ? `Ouvrir dans ADetailing : ${appUrl}/prestations?intervention=${intervention.id}` : null,
          ].filter(Boolean).join("\n\n");

          for (const calendarId of calendarIds) {
            const mapping = mappings.find((item) => item.intervention_id === intervention.id && item.google_calendar_id === calendarId);
            if (!input.connectionId && mapping?.last_internal_version === intervention.updated_at && mapping.sync_status === "synced") {
              totals.unchanged += 1;
              continue;
            }
            try {
              const googleEvent = await upsertGoogleEvent(accessToken, calendarId, mapping?.google_event_id, {
                summary: `ADetailing · ${intervention.title}`,
                description,
                location: intervention.address ?? undefined,
                start: startAt,
                end: endAt,
                interventionId: intervention.id,
              });
              const { error } = await supabase.from("calendar_event_mappings").upsert({
                organization_id: workspace.organizationId,
                connection_id: connection.id,
                intervention_id: intervention.id,
                google_calendar_id: calendarId,
                google_event_id: googleEvent.id,
                google_etag: googleEvent.etag ?? null,
                last_internal_version: intervention.updated_at,
                last_google_version: googleEvent.updated ?? new Date().toISOString(),
                sync_status: "synced",
                last_error: null,
              }, { onConflict: "connection_id,intervention_id,google_calendar_id" });
              if (error) throw error;
              if (mapping) totals.updated += 1;
              else totals.created += 1;
            } catch (cause) {
              if (mapping) {
                await supabase.from("calendar_event_mappings").update({
                  sync_status: "error",
                  last_error: cause instanceof Error ? cause.message : "Synchronisation impossible.",
                }).eq("id", mapping.id);
              }
              throw cause;
            }
          }
        }

        const { error: timestampError } = await supabase
          .from("google_calendar_connections")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("id", connection.id)
          .eq("profile_id", workspace.user.id);
        if (timestampError) throw timestampError;
      } catch (cause) {
        totals.errors.push(cause instanceof Error ? cause.message : "Synchronisation Google impossible.");
      }
    }

    return NextResponse.json({ success: totals.errors.length === 0, ...totals });
  } catch (cause) {
    if (cause instanceof z.ZodError) return NextResponse.json({ error: "Demande de synchronisation invalide." }, { status: 400 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Synchronisation Google impossible." }, { status: 500 });
  }
}
