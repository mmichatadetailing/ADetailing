import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const inputSchema = z.object({ organizationId: z.uuid() });

export async function POST(request: Request) {
  try {
    const { organizationId } = inputSchema.parse(await request.json());
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
    const { error } = await supabase.rpc("set_current_organization", { target_organization_id: organizationId });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Entreprise invalide." }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Changement impossible." }, { status: 500 });
  }
}
