import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next") ?? "/dashboard";
  let destination = new URL("/dashboard", request.url);
  try {
    const candidate = new URL(requestedNext, request.url);
    // URL parsers treat backslashes like slashes: a "/\\host" path is not internal.
    if (requestedNext.startsWith("/") && candidate.origin === request.nextUrl.origin) destination = candidate;
  } catch { /* Keep the dashboard fallback for malformed return URLs. */ }
  if (!code) return NextResponse.redirect(new URL("/connexion?error=missing-code", request.url));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/connexion?error=invalid-link", request.url));
  return NextResponse.redirect(destination);
}

