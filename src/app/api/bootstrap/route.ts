import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { loadSupabaseAppData } from "@/lib/supabase/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ error: "Supabase n’est pas configuré." }, { status: 503 });
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
    try {
      return NextResponse.json(await loadSupabaseAppData(supabase, user));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Aucun espace de travail")) throw error;
      const { error: provisionError } = await supabase.rpc("ensure_user_workspace");
      if (provisionError) throw provisionError;
      return NextResponse.json(await loadSupabaseAppData(supabase, user));
    }
  } catch (error) {
    console.error("Supabase bootstrap failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Impossible de charger l’espace de travail." }, { status: 500 });
  }
}

