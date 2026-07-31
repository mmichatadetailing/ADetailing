import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { MemberRole } from "@/lib/domain/types";

export interface AuthenticatedWorkspace {
  user: User;
  organizationId: string;
  locationId: string | null;
  role: MemberRole;
}

export async function requireAuthenticatedWorkspace(supabase: SupabaseClient): Promise<AuthenticatedWorkspace> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Authentification requise.");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single();
  if (profileError) throw profileError;

  const { data: memberships, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id,location_id,role,created_at")
    .eq("profile_id", user.id)
    .eq("active", true)
    .order("created_at");
  if (membershipError) throw membershipError;
  const membership = memberships?.find((item) => item.organization_id === profile.current_organization_id) ?? memberships?.[0];
  if (!membership) throw new Error("Espace de travail introuvable.");

  return {
    user,
    organizationId: membership.organization_id,
    locationId: membership.location_id,
    role: membership.role as MemberRole,
  };
}

export function canManageTeam(role: MemberRole) {
  return role === "admin" || role === "partner";
}
