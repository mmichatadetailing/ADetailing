import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canManageTeam, requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";

const paramsSchema = z.object({ id: z.uuid() });

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    if (!canManageTeam(workspace.role)) return NextResponse.json({ error: "Vous ne pouvez pas gérer cette équipe." }, { status: 403 });
    const { error } = await supabase
      .from("organization_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", workspace.organizationId)
      .is("accepted_at", null);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invitation invalide." }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Révocation impossible." }, { status: 500 });
  }
}
