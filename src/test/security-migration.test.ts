import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202607300001_initial_schema.sql"), "utf8");
const accountMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/202607300002_account_onboarding.sql"), "utf8");
const teamMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/202607310003_team_accounts_and_private_messaging.sql"), "utf8");
const preinviteMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608030008_preinvite_team_members.sql"), "utf8");
const googleCalendarMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608040012_google_calendar_user_connections.sql"), "utf8");

describe("migration de sécurité", () => {
  it("active la RLS et isole les données par organisation", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("public.is_org_member(organization_id)");
  });
  it("audite les tables financières et les rôles", () => {
    expect(migration).toContain("audit_sensitive_change");
    expect(migration).toContain("'quotes','invoices','payments','expenses','assets','monthly_objectives','organization_members'");
  });
  it("garde les buckets privés", () => expect(migration).toContain("'documents', 'documents', false"));
});

describe("provisionnement des comptes", () => {
  it("crée automatiquement un profil et un espace isolé", () => {
    expect(accountMigration).toContain("on_auth_user_created");
    expect(accountMigration).toContain("provision_user_workspace");
    expect(accountMigration).toContain("organization_members");
  });
  it("n’expose au rôle authentifié que l’opération idempotente", () => {
    expect(accountMigration).toContain("revoke all on function public.provision_user_workspace");
    expect(accountMigration).toContain("grant execute on function public.ensure_user_workspace() to authenticated");
  });
});

describe("comptes d’équipe et messagerie", () => {
  it("stocke seulement le hash des invitations et vérifie l’adresse invitée", () => {
    expect(teamMigration).toContain("token_hash text not null unique");
    expect(teamMigration).toContain("extensions.digest(invitation_token, 'sha256')");
    expect(teamMigration).toContain("target_email");
  });
  it("rejoint l’entreprise invitante sans créer un espace concurrent", () => {
    expect(teamMigration).toContain("accept_organization_invitation_for_user");
    expect(teamMigration).toContain("invitation_token :=");
    expect(teamMigration).toContain("current_organization_id");
  });
  it("limite les conversations de dossier à leurs participants", () => {
    expect(teamMigration).toContain("can_access_conversation");
    expect(teamMigration).toContain("messages_participant_select");
    expect(teamMigration).toContain("conversation_members cm");
  });
});

describe("membres préparés avant invitation", () => {
  it("autorise une identité d’équipe sans faux compte utilisateur", () => {
    expect(preinviteMigration).toContain("alter column profile_id drop not null");
    expect(preinviteMigration).toContain("organization_members_identity_check");
    expect(preinviteMigration).toContain("provisional_first_name");
  });

  it("conserve les affectations quand le compte rejoint l’équipe", () => {
    expect(preinviteMigration).toContain("pending_member_id uuid references public.organization_members");
    expect(preinviteMigration).toContain("set profile_id = target_user_id, pending_member_id = null");
    expect(preinviteMigration).toContain("invitation_record.pending_member_id");
  });
});

describe("connexions Google Calendar", () => {
  it("réserve chaque connexion et ses événements à son propriétaire", () => {
    expect(googleCalendarMigration).toContain("google_calendar_connections_self_select");
    expect(googleCalendarMigration).toContain("connection.profile_id = auth.uid()");
    expect(googleCalendarMigration).toContain("calendar_event_mappings_self_delete");
  });

  it("empêche plusieurs événements pour la même prestation et le même calendrier", () => {
    expect(googleCalendarMigration).toContain("unique (connection_id, intervention_id, google_calendar_id)");
  });
});
