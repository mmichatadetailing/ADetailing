import { z } from "zod";
import { tokenEncryptionKeyStatus } from "./token-crypto";

const oauthContextSchema = z.object({
  state: z.string().uuid(),
  organizationId: z.string().uuid(),
  profileId: z.string().uuid(),
});

export type GoogleOAuthContext = z.infer<typeof oauthContextSchema>;
export type GoogleCalendarConfigurationIssue = "missing-credentials" | "missing-encryption-key" | "invalid-encryption-key" | null;

export function googleCalendarConfigurationIssue(): GoogleCalendarConfigurationIssue {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return "missing-credentials";
  const keyStatus = tokenEncryptionKeyStatus();
  if (keyStatus === "missing") return "missing-encryption-key";
  if (keyStatus === "invalid") return "invalid-encryption-key";
  return null;
}

export function isGoogleCalendarConfigured() {
  return googleCalendarConfigurationIssue() === null;
}

export function googleConfigurationStatus(issue: GoogleCalendarConfigurationIssue) {
  if (issue === "missing-encryption-key") return "missing-encryption-key";
  if (issue === "invalid-encryption-key") return "invalid-encryption-key";
  return "missing-config";
}

export function googleCallbackErrorStatus(cause: unknown) {
  const error = cause as { code?: string; message?: string } | null;
  if (error?.message?.includes("OAUTH_TOKEN_ENCRYPTION_KEY")) return "invalid-encryption-key";
  if (error?.code === "42P01" || error?.code === "PGRST205") return "database-migration-error";
  if (error?.code === "42501") return "database-permission-error";
  return "save-error";
}

export function getGoogleRedirectUri(requestUrl: string) {
  const origin = new URL(requestUrl).origin;
  return new URL("/api/integrations/google/callback", origin).toString();
}

export function encodeGoogleOAuthContext(context: GoogleOAuthContext) {
  return Buffer.from(JSON.stringify(context), "utf8").toString("base64url");
}

export function decodeGoogleOAuthContext(value?: string) {
  if (!value) return null;
  try {
    return oauthContextSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}
