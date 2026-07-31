import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { encryptToken } from "@/lib/integrations/token-crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  if (!code || !state || state !== cookieStore.get("google_oauth_state")?.value) return NextResponse.redirect(new URL("/parametres?google=invalid-state", request.url));
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/connexion", request.url));
  const body = new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? "", grant_type: "authorization_code" });
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  if (!tokenResponse.ok) return NextResponse.redirect(new URL("/parametres?google=token-error", request.url));
  const tokens = await tokenResponse.json() as { access_token: string; refresh_token?: string };
  if (!tokens.refresh_token) return NextResponse.redirect(new URL("/parametres?google=no-refresh-token", request.url));
  const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" });
  const userInfo = await userInfoResponse.json() as { email?: string };
  const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("profile_id", user.id).eq("active", true).limit(1).single();
  if (!membership) return NextResponse.redirect(new URL("/parametres?google=no-organization", request.url));
  await supabase.from("google_calendar_connections").upsert({ organization_id: membership.organization_id, profile_id: user.id, google_account_email: userInfo.email ?? "Google", encrypted_refresh_token: encryptToken(tokens.refresh_token), selected_calendar_ids: [], sync_enabled: true }, { onConflict: "organization_id,profile_id,google_account_email" });
  const response = NextResponse.redirect(new URL("/parametres?google=connected", request.url));
  response.cookies.delete("google_oauth_state");
  return response;
}
