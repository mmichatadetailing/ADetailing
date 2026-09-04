import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listGoogleCalendars } from "@/lib/integrations/google-calendar";
import { decodeGoogleOAuthContext, getGoogleRedirectUri, googleCalendarConfigurationIssue, googleCallbackErrorStatus, googleConfigurationStatus } from "@/lib/integrations/google-oauth";
import { encryptToken } from "@/lib/integrations/token-crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function redirectToSettings(request: Request, status: string) {
  const response = NextResponse.redirect(new URL(`/parametres?google=${status}#integrations`, request.url));
  response.cookies.delete("google_oauth_context");
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return redirectToSettings(request, "access-denied");
  const configurationIssue = googleCalendarConfigurationIssue();
  if (configurationIssue) return redirectToSettings(request, googleConfigurationStatus(configurationIssue));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const context = decodeGoogleOAuthContext(cookieStore.get("google_oauth_context")?.value);
  if (!code || !state || !context || state !== context.state) return redirectToSettings(request, "invalid-state");

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== context.profileId) return NextResponse.redirect(new URL("/connexion", request.url));

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("organization_id", context.organizationId)
      .eq("profile_id", user.id)
      .eq("active", true)
      .maybeSingle();
    if (!membership) return redirectToSettings(request, "no-organization");

    const body = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: getGoogleRedirectUri(request.url),
      grant_type: "authorization_code",
    });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    if (!tokenResponse.ok) return redirectToSettings(request, "token-error");
    const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string };
    if (!tokens.access_token) return redirectToSettings(request, "token-error");

    const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      cache: "no-store",
    });
    if (!userInfoResponse.ok) return redirectToSettings(request, "account-error");
    const userInfo = await userInfoResponse.json() as { email?: string };
    const email = userInfo.email?.trim().toLowerCase();
    if (!email) return redirectToSettings(request, "account-error");

    const { data: existing, error: existingError } = await supabase
      .from("google_calendar_connections")
      .select("encrypted_refresh_token,selected_calendar_ids")
      .eq("organization_id", context.organizationId)
      .eq("profile_id", user.id)
      .eq("google_account_email", email)
      .maybeSingle();
    if (existingError) throw existingError;
    const encryptedRefreshToken = tokens.refresh_token ? encryptToken(tokens.refresh_token) : existing?.encrypted_refresh_token;
    if (!encryptedRefreshToken) return redirectToSettings(request, "no-refresh-token");

    let selectedCalendarIds = Array.isArray(existing?.selected_calendar_ids)
      ? existing.selected_calendar_ids.filter((item): item is string => typeof item === "string")
      : [];
    if (selectedCalendarIds.length === 0) {
      try {
        const calendars = await listGoogleCalendars(tokens.access_token);
        const primaryCalendar = calendars.find((calendar) => calendar.primary && ["owner", "writer"].includes(calendar.accessRole ?? ""));
        if (primaryCalendar) selectedCalendarIds = [primaryCalendar.id];
      } catch {
        // Le compte reste connecté : l’utilisateur pourra choisir le calendrier plus tard.
      }
    }

    const { error: upsertError } = await supabase.from("google_calendar_connections").upsert({
      organization_id: context.organizationId,
      profile_id: user.id,
      google_account_email: email,
      encrypted_refresh_token: encryptedRefreshToken,
      selected_calendar_ids: selectedCalendarIds,
      sync_enabled: true,
    }, { onConflict: "organization_id,profile_id,google_account_email" });
    if (upsertError) throw upsertError;
    return redirectToSettings(request, "connected");
  } catch (cause) {
    const status = googleCallbackErrorStatus(cause);
    console.error("[google-calendar] OAuth callback failed", {
      status,
      code: typeof cause === "object" && cause && "code" in cause ? String(cause.code) : undefined,
      message: cause instanceof Error ? cause.message : "Unknown Google Calendar callback error",
    });
    return redirectToSettings(request, status);
  }
}
