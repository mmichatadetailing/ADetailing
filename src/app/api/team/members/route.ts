import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canManageTeam, requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";

const memberSchema = z.object({
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  email: z.email().or(z.literal("")),
  role: z.enum(["partner", "employee"]),
  weeklyCapacityMinutes: z.number().int().min(60).max(4800),
});

export async function POST(request: Request) {
  try {
    const input = memberSchema.parse(await request.json());
    const email = input.email.trim().toLowerCase();
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    if (!canManageTeam(workspace.role)) return NextResponse.json({ error: "Vous ne pouvez pas gérer cette équipe." }, { status: 403 });

    if (email) {
      const [{ data: accountMember, error: accountError }, { data: pendingMember, error: pendingError }] = await Promise.all([
        supabase.from("organization_members").select("id,profiles!inner(email)").eq("organization_id", workspace.organizationId).eq("profiles.email", email).limit(1).maybeSingle(),
        supabase.from("organization_members").select("id").eq("organization_id", workspace.organizationId).is("profile_id", null).eq("provisional_email", email).limit(1).maybeSingle(),
      ]);
      if (accountError) throw accountError;
      if (pendingError) throw pendingError;
      if (accountMember || pendingMember) return NextResponse.json({ error: "Cette personne existe déjà dans l’équipe." }, { status: 409 });
    }

    const { data, error } = await supabase
      .from("organization_members")
      .insert({
        organization_id: workspace.organizationId,
        profile_id: null,
        role: input.role,
        location_id: workspace.locationId,
        active: true,
        weekly_capacity_minutes: input.weeklyCapacityMinutes,
        provisional_first_name: input.firstName,
        provisional_last_name: input.lastName,
        provisional_email: email,
      })
      .select("id")
      .single();
    if (error) throw error;
    if (!data) throw new Error("Collaborateur introuvable après sa création.");
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Les informations du collaborateur sont invalides." }, { status: 400 });
    console.error("Pending team member creation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ajout impossible." }, { status: 500 });
  }
}
