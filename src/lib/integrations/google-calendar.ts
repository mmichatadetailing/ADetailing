import { decryptToken } from "./token-crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: "freeBusyReader" | "reader" | "writer" | "owner";
  backgroundColor?: string;
}

export interface GoogleCalendarEventItem {
  id: string;
  etag?: string;
  summary?: string;
  status?: string;
  eventType?: string;
  htmlLink?: string;
  location?: string;
  transparency?: "opaque" | "transparent";
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  updated?: string;
  extendedProperties?: { private?: Record<string, string> };
}

interface GoogleEventPayload {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  interventionId?: string;
}

async function googleError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return payload?.error?.message || `${fallback} (${response.status}).`;
}

export async function refreshGoogleAccessToken(encryptedRefreshToken: string) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("La connexion Google Calendar n’est pas configurée sur le serveur.");
  }
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: decryptToken(encryptedRefreshToken),
    grant_type: "refresh_token",
  });
  const response = await fetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  if (!response.ok) throw new Error(await googleError(response, "Le renouvellement de l’accès Google a échoué"));
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Google n’a pas renvoyé de jeton d’accès.");
  return payload.access_token;
}

export async function listGoogleCalendars(accessToken: string): Promise<GoogleCalendarListItem[]> {
  const calendars: GoogleCalendarListItem[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList?${params}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    if (!response.ok) throw new Error(await googleError(response, "La liste des calendriers Google est inaccessible"));
    const payload = await response.json() as { items?: GoogleCalendarListItem[]; nextPageToken?: string };
    calendars.push(...(payload.items ?? []));
    pageToken = payload.nextPageToken;
  } while (pageToken);
  return calendars;
}

export async function listGoogleEvents(accessToken: string, calendarId: string, timeMin: string, timeMax: string) {
  const events: GoogleCalendarEventItem[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", showDeleted: "false", maxResults: "2500" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    if (!response.ok) throw new Error(await googleError(response, "Les événements Google sont inaccessibles"));
    const payload = await response.json() as { items?: GoogleCalendarEventItem[]; nextPageToken?: string };
    events.push(...(payload.items ?? []));
    pageToken = payload.nextPageToken;
  } while (pageToken);
  return events;
}

export async function upsertGoogleEvent(accessToken: string, calendarId: string, eventId: string | undefined, payload: GoogleEventPayload) {
  const endpoint = eventId
    ? `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    : `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  const response = await fetch(endpoint, {
    method: eventId ? "PATCH" : "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary: payload.summary,
      description: payload.description,
      location: payload.location,
      start: { dateTime: payload.start, timeZone: "Europe/Paris" },
      end: { dateTime: payload.end, timeZone: "Europe/Paris" },
      extendedProperties: payload.interventionId ? { private: { adetailingInterventionId: payload.interventionId } } : undefined,
    }),
    cache: "no-store",
  });
  if (eventId && response.status === 404) return upsertGoogleEvent(accessToken, calendarId, undefined, payload);
  if (!response.ok) throw new Error(await googleError(response, "L’écriture de l’événement Google a échoué"));
  return response.json() as Promise<{ id: string; etag?: string; updated?: string }>;
}

export async function deleteGoogleEvent(accessToken: string, calendarId: string, eventId: string) {
  const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(await googleError(response, "La suppression de l’événement Google a échoué"));
  }
}

export async function revokeGoogleRefreshToken(encryptedRefreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: decryptToken(encryptedRefreshToken) }),
    cache: "no-store",
  });
  return response.ok;
}
