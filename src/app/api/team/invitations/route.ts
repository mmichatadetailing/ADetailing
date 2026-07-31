import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canManageTeam, requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";

export const runtime = "nodejs";

const invitationSchema = z.object({
  email: z.email(),
  role: z.enum(["partner", "employee"]),
  weeklyCapacityMinutes: z.number().int().min(60).max(4800),
});

export async function POST(request: Request) {
  try {
    const input = invitationSchema.parse(await request.json());
    const email = input.email.trim().toLowerCase();
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    if (!canManageTeam(workspace.role)) return NextResponse.json({ error: "Vous ne pouvez pas gérer cette équipe." }, { status: 403 });

    const { data: existingMember, error: memberError } = await supabase
      .from("organization_members")
      .select("profile_id,profiles!inner(email)")
      .eq("organization_id", workspace.organizationId)
      .eq("active", true)
      .eq("profiles.email", email)
      .limit(1)
      .maybeSingle();
    if (memberError) throw memberError;
    if (existingMember) return NextResponse.json({ error: "Cette personne fait déjà partie de l’équipe." }, { status: 409 });

    const { error: revokeError } = await supabase
      .from("organization_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("organization_id", workspace.organizationId)
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null);
    if (revokeError) throw revokeError;

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { data, error } = await supabase
      .from("organization_invitations")
      .insert({
        organization_id: workspace.organizationId,
        email,
        role: input.role,
        location_id: workspace.locationId,
        weekly_capacity_minutes: input.weeklyCapacityMinutes,
        token_hash: tokenHash,
        invited_by: workspace.user.id,
      })
      .select("id,email,role,weekly_capacity_minutes,expires_at,created_at")
      .single();
    if (error) throw error;

    const invitationUrl = new URL("/connexion", request.url);
    invitationUrl.searchParams.set("invitation", token);
    return NextResponse.json({
      invitation: {
        id: data.id,
        email: data.email,
        role: data.role,
        weeklyCapacityMinutes: data.weekly_capacity_minutes,
        expiresAt: data.expires_at,
        createdAt: data.created_at,
      },
      invitationUrl: invitationUrl.toString(),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Les informations de l’invitation sont invalides." }, { status: 400 });
    console.error("Invitation creation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invitation impossible." }, { status: 500 });
  }
}
