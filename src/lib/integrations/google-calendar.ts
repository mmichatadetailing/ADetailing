import { decryptToken } from "./token-crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export async function refreshGoogleAccessToken(encryptedRefreshToken: string) {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    refresh_token: decryptToken(encryptedRefreshToken),
    grant_type: "refresh_token",
  });
  const response = await fetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  if (!response.ok) throw new Error(`Google token refresh failed (${response.status}).`);
  const payload = await response.json() as { access_token: string };
  return payload.access_token;
}

export async function listGoogleCalendars(accessToken: string) {
  const response = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Google calendar list failed (${response.status}).`);
  const payload = await response.json() as { items?: Array<{ id: string; summary: string; primary?: boolean; accessRole?: string }> };
  return payload.items ?? [];
}

export async function listGoogleEvents(accessToken: string, calendarId: string, timeMin: string, timeMax: string) {
  const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", showDeleted: "false", maxResults: "2500" });
  const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Google events list failed (${response.status}).`);
  const payload = await response.json() as { items?: Array<{ id: string; etag?: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; updated?: string }> };
  return payload.items ?? [];
}

export async function upsertGoogleEvent(accessToken: string, calendarId: string, eventId: string | undefined, payload: { summary: string; description?: string; start: string; end: string }) {
  const endpoint = eventId
    ? `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    : `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  const response = await fetch(endpoint, {
    method: eventId ? "PATCH" : "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ summary: payload.summary, description: payload.description, start: { dateTime: payload.start, timeZone: "Europe/Paris" }, end: { dateTime: payload.end, timeZone: "Europe/Paris" } }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Google event write failed (${response.status}).`);
  return response.json() as Promise<{ id: string; etag?: string; updated?: string }>;
}

