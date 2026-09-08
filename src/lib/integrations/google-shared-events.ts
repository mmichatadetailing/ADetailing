import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { listGoogleCalendars, listGoogleEvents, refreshGoogleAccessToken, type GoogleCalendarEventItem } from "@/lib/integrations/google-calendar";
import type { GooglePlanningEvent } from "@/lib/integrations/google-calendar-types";

type CalendarConnection = {
  id: string;
  profile_id: string;
  google_account_email: string;
  encrypted_refresh_token: string;
  selected_calendar_ids: unknown;
};

type SharedGoogleEventRow = {
  id: string;
  organization_id: string;
  owner_profile_id: string;
  connection_id: string;
  google_calendar_id: string;
  google_event_id: string;
  calendar_name: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  busy: boolean;
  color: string | null;
  location_label: string | null;
  last_seen_at?: string;
};

type SharedGoogleEventWrite = Omit<SharedGoogleEventRow, "id">;

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

function calendarEventValues(event: GoogleCalendarEventItem) {
  const rawStart = event.start?.dateTime ?? event.start?.date;
  const rawEnd = event.end?.dateTime ?? event.end?.date;
  if (!rawStart || !rawEnd || event.status === "cancelled") return null;
  if (event.extendedProperties?.private?.adetailingInterventionId) return null;
  if (event.eventType === "birthday" || event.eventType === "workingLocation") return null;
  const start = new Date(rawStart);
  const end = new Date(rawEnd);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  return { start: start.toISOString(), end: end.toISOString(), allDay: Boolean(event.start?.date) };
}

function chunks<T>(items: T[], size = 200) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

export async function refreshOwnGoogleSharedEvents({
  supabase,
  organizationId,
  profileId,
  timeMin,
  timeMax,
  connectionId,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  profileId: string;
  timeMin: string;
  timeMax: string;
  connectionId?: string;
}) {
  let connectionQuery = supabase
    .from("google_calendar_connections")
    .select("id,profile_id,google_account_email,encrypted_refresh_token,selected_calendar_ids")
    .eq("organization_id", organizationId)
    .eq("profile_id", profileId)
    .eq("sync_enabled", true);
  if (connectionId) connectionQuery = connectionQuery.eq("id", connectionId);
  const { data: connectionData, error: connectionError } = await connectionQuery;
  if (connectionError) throw connectionError;

  const connections = (connectionData ?? []) as CalendarConnection[];
  const ownEvents: GooglePlanningEvent[] = [];
  const errors: string[] = [];
  let sharedCount = 0;

  for (const connection of connections) {
    try {
      const accessToken = await refreshGoogleAccessToken(connection.encrypted_refresh_token);
      const calendars = await listGoogleCalendars(accessToken);
      const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));

      for (const calendarId of selectedCalendarIds(connection.selected_calendar_ids)) {
        const calendar = calendarsById.get(calendarId);
        const googleEvents = await listGoogleEvents(accessToken, calendarId, timeMin, timeMax);
        const rows: SharedGoogleEventWrite[] = [];
        const seenGoogleIds = new Set<string>();
        const seenAt = new Date().toISOString();

        for (const googleEvent of googleEvents) {
          const values = calendarEventValues(googleEvent);
          if (!values) continue;
          seenGoogleIds.add(googleEvent.id);
          const title = googleEvent.summary?.trim() || "Événement Google";
          const calendarName = calendar?.summary ?? "Google Calendar";
          const color = calendar?.backgroundColor ?? "#0ea5e9";
          const eventKey = `google:${connection.id}:${calendarId}:${googleEvent.id}`;
          rows.push({
            organization_id: organizationId,
            owner_profile_id: profileId,
            connection_id: connection.id,
            google_calendar_id: calendarId,
            google_event_id: googleEvent.id,
            calendar_name: calendarName,
            title,
            starts_at: values.start,
            ends_at: values.end,
            all_day: values.allDay,
            busy: googleEvent.transparency !== "transparent",
            color,
            location_label: googleEvent.location?.trim() || null,
            last_seen_at: seenAt,
          });
          ownEvents.push({
            id: eventKey,
            googleEventId: googleEvent.id,
            connectionId: connection.id,
            calendarId,
            calendarName,
            accountEmail: connection.google_account_email,
            memberId: profileId,
            ownerName: "Moi",
            ownedByCurrentUser: true,
            title,
            start: values.start,
            end: values.end,
            allDay: values.allDay,
            busy: googleEvent.transparency !== "transparent",
            color,
            location: googleEvent.location,
            htmlLink: safeGoogleLink(googleEvent.htmlLink),
          });
        }

        for (const batch of chunks(rows)) {
          const { error } = await supabase.from("google_calendar_shared_events").upsert(batch, { onConflict: "connection_id,google_calendar_id,google_event_id" });
          if (error) throw error;
        }

        const { data: cachedRows, error: cachedError } = await supabase
          .from("google_calendar_shared_events")
          .select("id,google_event_id")
          .eq("organization_id", organizationId)
          .eq("owner_profile_id", profileId)
          .eq("connection_id", connection.id)
          .eq("google_calendar_id", calendarId)
          .lt("starts_at", timeMax)
          .gt("ends_at", timeMin)
          .limit(5_000);
        if (cachedError) throw cachedError;
        const staleIds = (cachedRows ?? []).filter((row) => !seenGoogleIds.has(row.google_event_id as string)).map((row) => row.id as string);
        for (const batch of chunks(staleIds)) {
          const { error } = await supabase.from("google_calendar_shared_events").delete().in("id", batch).eq("owner_profile_id", profileId);
          if (error) throw error;
        }
        sharedCount += rows.length;
      }

      const { error: timestampError } = await supabase
        .from("google_calendar_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", connection.id)
        .eq("profile_id", profileId);
      if (timestampError) throw timestampError;
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : `Lecture impossible pour ${connection.google_account_email}.`);
    }
  }

  return {
    connected: connections.some((connection) => selectedCalendarIds(connection.selected_calendar_ids).length > 0),
    ownEvents,
    errors,
    sharedCount,
  };
}

export async function loadVisibleSharedGoogleEvents({
  supabase,
  organizationId,
  profileId,
  timeMin,
  timeMax,
  ownEvents,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  profileId: string;
  timeMin: string;
  timeMax: string;
  ownEvents: GooglePlanningEvent[];
}) {
  const { data, error } = await supabase
    .from("google_calendar_shared_events")
    .select("id,organization_id,owner_profile_id,connection_id,google_calendar_id,google_event_id,calendar_name,title,starts_at,ends_at,all_day,busy,color,location_label")
    .eq("organization_id", organizationId)
    .lt("starts_at", timeMax)
    .gt("ends_at", timeMin)
    .order("starts_at")
    .limit(5_000);
  if (error) throw error;
  const rows = (data ?? []) as SharedGoogleEventRow[];
  const ownerIds = [...new Set(rows.map((row) => row.owner_profile_id))];
  const ownerNames = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase.from("profiles").select("id,first_name,last_name").in("id", ownerIds);
    if (profileError) throw profileError;
    for (const profile of profiles ?? []) {
      ownerNames.set(profile.id as string, [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Collaborateur");
    }
  }
  const ownEventsBySource = new Map(ownEvents.map((event) => [`${event.connectionId}:${event.calendarId}:${event.googleEventId}`, event]));

  return rows.map((row): GooglePlanningEvent => {
    const ownEvent = ownEventsBySource.get(`${row.connection_id}:${row.google_calendar_id}:${row.google_event_id}`);
    const ownedByCurrentUser = row.owner_profile_id === profileId;
    return {
      id: `google:${row.id}`,
      ...(ownedByCurrentUser ? { googleEventId: row.google_event_id, connectionId: row.connection_id, calendarId: row.google_calendar_id } : {}),
      calendarName: row.calendar_name,
      accountEmail: ownedByCurrentUser ? ownEvent?.accountEmail : undefined,
      memberId: row.owner_profile_id,
      ownerName: ownedByCurrentUser ? "Moi" : ownerNames.get(row.owner_profile_id) ?? "Collaborateur",
      ownedByCurrentUser,
      title: row.title,
      start: row.starts_at,
      end: row.ends_at,
      allDay: row.all_day,
      busy: row.busy,
      color: row.color ?? "#0ea5e9",
      location: row.location_label ?? undefined,
      htmlLink: ownedByCurrentUser ? ownEvent?.htmlLink : undefined,
    };
  });
}

export function rollingGoogleShareRange(now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - 60);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 365);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}
