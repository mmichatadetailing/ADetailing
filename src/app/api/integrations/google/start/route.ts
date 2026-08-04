import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { encodeGoogleOAuthContext, getGoogleRedirectUri, isGoogleCalendarConfigured } from "@/lib/integrations/google-oauth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";

export async function GET(request: Request) {
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.redirect(new URL("/parametres?google=missing-config#integrations", request.url));
  }

  try {
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    const state = randomUUID();
    const redirectUri = getGoogleRedirectUri(request.url);
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      scope: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        "https://www.googleapis.com/auth/calendar.events",
      ].join(" "),
    });
    const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    response.cookies.set("google_oauth_context", encodeGoogleOAuthContext({
      state,
      organizationId: workspace.organizationId,
      profileId: workspace.user.id,
    }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/connexion", request.url));
  }
}
