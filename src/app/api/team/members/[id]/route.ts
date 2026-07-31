import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canManageTeam, requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";

const paramsSchema = z.object({ id: z.uuid() });
const updateSchema = z.object({
  active: z.boolean().optional(),
  role: z.enum(["admin", "partner", "employee"]).optional(),
  weeklyCapacityMinutes: z.number().int().min(60).max(4800).optional(),
}).refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const input = updateSchema.parse(await request.json());
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    if (!canManageTeam(workspace.role)) return NextResponse.json({ error: "Vous ne pouvez pas gérer cette équipe." }, { status: 403 });

    const { data: target, error: targetError } = await supabase
      .from("organization_members")
      .select("id,profile_id,role,active")
      .eq("organization_id", workspace.organizationId)
      .eq("profile_id", id)
      .single();
    if (targetError) throw targetError;
    if (input.role === "admin" && workspace.role !== "admin") return NextResponse.json({ error: "Seul un administrateur peut nommer un autre administrateur." }, { status: 403 });
    if (target.profile_id === workspace.user.id && input.active === false) return NextResponse.json({ error: "Vous ne pouvez pas désactiver votre propre compte." }, { status: 409 });

    const removesAdmin = target.active && target.role === "admin" && (input.active === false || (input.role && input.role !== "admin"));
    if (removesAdmin) {
      const { count, error: countError } = await supabase
        .from("organization_members")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", workspace.organizationId)
        .eq("role", "admin")
        .eq("active", true);
      if (countError) throw countError;
      if ((count ?? 0) <= 1) return NextResponse.json({ error: "L’entreprise doit conserver au moins un administrateur actif." }, { status: 409 });
    }

    const patch: Record<string, unknown> = {};
    if (input.active !== undefined) patch.active = input.active;
    if (input.role !== undefined) patch.role = input.role;
    if (input.weeklyCapacityMinutes !== undefined) patch.weekly_capacity_minutes = input.weeklyCapacityMinutes;
    const { error } = await supabase.from("organization_members").update(patch).eq("id", target.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Modification invalide." }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Modification impossible." }, { status: 500 });
  }
}
