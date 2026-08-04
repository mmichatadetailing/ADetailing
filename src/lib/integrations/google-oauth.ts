import { z } from "zod";

const oauthContextSchema = z.object({
  state: z.string().uuid(),
  organizationId: z.string().uuid(),
  profileId: z.string().uuid(),
});

export type GoogleOAuthContext = z.infer<typeof oauthContextSchema>;

export function isGoogleCalendarConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID
      && process.env.GOOGLE_CLIENT_SECRET
      && process.env.GOOGLE_REDIRECT_URI
      && process.env.OAUTH_TOKEN_ENCRYPTION_KEY,
  );
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
