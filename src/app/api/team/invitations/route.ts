import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canManageTeam, requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";

export const runtime = "nodejs";

const invitationSchema = z.object({
  memberId: z.uuid().optional(),
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
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

    let pendingMemberId: string | null = null;
    if (input.memberId) {
      const { data: pendingMember, error: pendingMemberError } = await supabase
        .from("organization_members")
        .select("id,profile_id")
        .eq("id", input.memberId)
        .eq("organization_id", workspace.organizationId)
        .eq("active", true)
        .single();
      if (pendingMemberError) throw pendingMemberError;
      if (pendingMember.profile_id) return NextResponse.json({ error: "Ce membre possède déjà un compte." }, { status: 409 });

      const { data: duplicatePending, error: duplicatePendingError } = await supabase
        .from("organization_members")
        .select("id")
        .eq("organization_id", workspace.organizationId)
        .is("profile_id", null)
        .eq("provisional_email", email)
        .neq("id", pendingMember.id)
        .limit(1)
        .maybeSingle();
      if (duplicatePendingError) throw duplicatePendingError;
      if (duplicatePending) return NextResponse.json({ error: "Cette adresse est déjà utilisée par un autre membre préparé." }, { status: 409 });

      const { error: pendingUpdateError } = await supabase.from("organization_members").update({
        provisional_first_name: input.firstName,
        provisional_last_name: input.lastName,
        provisional_email: email,
        role: input.role,
        weekly_capacity_minutes: input.weeklyCapacityMinutes,
      }).eq("id", pendingMember.id).eq("organization_id", workspace.organizationId);
      if (pendingUpdateError) throw pendingUpdateError;
      pendingMemberId = pendingMember.id;
    }

    if (pendingMemberId) {
      const { error: memberRevokeError } = await supabase
        .from("organization_invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("organization_id", workspace.organizationId)
        .eq("pending_member_id", pendingMemberId)
        .is("accepted_at", null)
        .is("revoked_at", null);
      if (memberRevokeError) throw memberRevokeError;
    }

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
        pending_member_id: pendingMemberId,
        invited_first_name: input.firstName,
        invited_last_name: input.lastName,
        email,
        role: input.role,
        location_id: workspace.locationId,
        weekly_capacity_minutes: input.weeklyCapacityMinutes,
        token_hash: tokenHash,
        invited_by: workspace.user.id,
      })
      .select("id,pending_member_id,invited_first_name,invited_last_name,email,role,weekly_capacity_minutes,expires_at,created_at")
      .single();
    if (error) throw error;

    const invitationUrl = new URL("/connexion", request.url);
    invitationUrl.searchParams.set("invitation", token);
    return NextResponse.json({
      invitation: {
        id: data.id,
        memberId: data.pending_member_id ?? undefined,
        firstName: data.invited_first_name,
        lastName: data.invited_last_name,
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
