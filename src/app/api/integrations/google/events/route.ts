import { NextResponse } from "next/server";
import { z } from "zod";
import { listGoogleCalendars, listGoogleEvents, refreshGoogleAccessToken } from "@/lib/integrations/google-calendar";
import type { GooglePlanningEvent, GooglePlanningEventsResponse } from "@/lib/integrations/google-calendar-types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";

const querySchema = z.object({
  timeMin: z.string().datetime(),
  timeMax: z.string().datetime(),
}).refine(({ timeMin, timeMax }) => {
  const duration = new Date(timeMax).getTime() - new Date(timeMin).getTime();
  return duration > 0 && duration <= 370 * 24 * 60 * 60 * 1_000;
}, "La période demandée est invalide.");

type CalendarConnection = {
  id: string;
  google_account_email: string;
  encrypted_refresh_token: string;
  selected_calendar_ids: unknown;
};

function selectedCalendarIds(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 10)
    : [];
}

function safeGoogleLink(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "google.com" || url.hostname.endsWith(".google.com")) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({ timeMin: url.searchParams.get("timeMin"), timeMax: url.searchParams.get("timeMax") });
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    const { data, error } = await supabase
      .from("google_calendar_connections")
      .select("id,google_account_email,encrypted_refresh_token,selected_calendar_ids")
      .eq("organization_id", workspace.organizationId)
      .eq("profile_id", workspace.user.id)
      .eq("sync_enabled", true);
    if (error) throw error;

    const connections = (data ?? []) as CalendarConnection[];
    const events: GooglePlanningEvent[] = [];
    const errors: string[] = [];

    for (const connection of connections) {
      try {
        const accessToken = await refreshGoogleAccessToken(connection.encrypted_refresh_token);
        const calendars = await listGoogleCalendars(accessToken);
        const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));

        for (const calendarId of selectedCalendarIds(connection.selected_calendar_ids)) {
          const calendar = calendarsById.get(calendarId);
          const googleEvents = await listGoogleEvents(accessToken, calendarId, input.timeMin, input.timeMax);
          for (const googleEvent of googleEvents) {
            const start = googleEvent.start?.dateTime ?? googleEvent.start?.date;
            const end = googleEvent.end?.dateTime ?? googleEvent.end?.date;
            if (!start || !end || googleEvent.status === "cancelled") continue;
            if (googleEvent.extendedProperties?.private?.adetailingInterventionId) continue;
            if (googleEvent.eventType === "birthday" || googleEvent.eventType === "workingLocation") continue;
            events.push({
              id: `google:${connection.id}:${calendarId}:${googleEvent.id}`,
              googleEventId: googleEvent.id,
              connectionId: connection.id,
              calendarId,
              calendarName: calendar?.summary ?? "Google Calendar",
              accountEmail: connection.google_account_email,
              memberId: workspace.user.id,
              title: googleEvent.summary?.trim() || "Événement Google",
              start,
              end,
              allDay: Boolean(googleEvent.start?.date),
              busy: googleEvent.transparency !== "transparent",
              color: calendar?.backgroundColor ?? "#0ea5e9",
              location: googleEvent.location,
              htmlLink: safeGoogleLink(googleEvent.htmlLink),
            });
          }
        }
      } catch (cause) {
        errors.push(cause instanceof Error ? cause.message : `Lecture impossible pour ${connection.google_account_email}.`);
      }
    }

    const response: GooglePlanningEventsResponse = {
      connected: connections.some((connection) => selectedCalendarIds(connection.selected_calendar_ids).length > 0),
      events,
      errors,
      syncedAt: new Date().toISOString(),
    };
    return NextResponse.json(response, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof z.ZodError) return NextResponse.json({ error: "Période Google Calendar invalide." }, { status: 400 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Lecture de Google Calendar impossible." }, { status: 500 });
  }
}
