import { afterEach, describe, expect, it } from "vitest";
import { decodeGoogleOAuthContext, encodeGoogleOAuthContext, getGoogleRedirectUri, googleCalendarConfigurationIssue, googleCallbackErrorStatus } from "./google-oauth";

const originalEnvironment = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  OAUTH_TOKEN_ENCRYPTION_KEY: process.env.OAUTH_TOKEN_ENCRYPTION_KEY,
};

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const context = {
  state: "2b695229-213e-4f83-906c-89de416ecba5",
  organizationId: "d6a14f53-b9c5-42b9-84c2-2fe3a70a7c42",
  profileId: "92992624-77aa-46be-835b-874521384bcc",
};

describe("contexte OAuth Google", () => {
  it("conserve l’état, l’utilisateur et l’entreprise pendant le retour OAuth", () => {
    expect(decodeGoogleOAuthContext(encodeGoogleOAuthContext(context))).toEqual(context);
  });

  it("refuse un cookie OAuth incomplet ou altéré", () => {
    expect(decodeGoogleOAuthContext("valeur-invalide")).toBeNull();
    expect(decodeGoogleOAuthContext()).toBeNull();
  });
});

describe("adresse de retour OAuth Google", () => {
  it("reste sur le domaine Vercel depuis lequel la connexion a commencé", () => {
    expect(getGoogleRedirectUri("https://adetailing.vercel.app/api/integrations/google/start"))
      .toBe("https://adetailing.vercel.app/api/integrations/google/callback");
  });

  it("conserve localhost uniquement pendant le développement local", () => {
    expect(getGoogleRedirectUri("http://localhost:3000/api/integrations/google/start"))
      .toBe("http://localhost:3000/api/integrations/google/callback");
  });
});

describe("diagnostic de la configuration Google", () => {
  it("détecte une clé Vercel présente mais invalide avant le consentement", () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = "pas-une-cle-de-32-octets";
    expect(googleCalendarConfigurationIssue()).toBe("invalid-encryption-key");
  });

  it("accepte une clé base64 de 32 octets entourée de guillemets", () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = `"${Buffer.alloc(32, 7).toString("base64")}"`;
    expect(googleCalendarConfigurationIssue()).toBeNull();
  });

  it("transforme les erreurs Supabase courantes en messages actionnables", () => {
    expect(googleCallbackErrorStatus({ code: "42P01" })).toBe("database-migration-error");
    expect(googleCallbackErrorStatus({ code: "42501" })).toBe("database-permission-error");
  });
});
