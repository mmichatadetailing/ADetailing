import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202607300001_initial_schema.sql"), "utf8");
const accountMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/202607300002_account_onboarding.sql"), "utf8");
const teamMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/202607310003_team_accounts_and_private_messaging.sql"), "utf8");

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
