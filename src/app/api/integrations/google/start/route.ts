import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri || !process.env.OAUTH_TOKEN_ENCRYPTION_KEY) return NextResponse.redirect(new URL("/parametres?google=missing-config", request.url));
  const state = randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    state,
    scope: ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"].join(" "),
  });
  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  response.cookies.set("google_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  return response;
}

