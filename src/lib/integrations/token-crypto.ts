import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type TokenEncryptionKeyStatus = "valid" | "missing" | "invalid";

function encodedEncryptionKey() {
  const rawValue = process.env.OAUTH_TOKEN_ENCRYPTION_KEY?.trim();
  if (!rawValue) return "";
  const hasMatchingQuotes = (rawValue.startsWith('"') && rawValue.endsWith('"'))
    || (rawValue.startsWith("'") && rawValue.endsWith("'"));
  return hasMatchingQuotes ? rawValue.slice(1, -1).trim() : rawValue;
}

export function tokenEncryptionKeyStatus(): TokenEncryptionKeyStatus {
  const encoded = encodedEncryptionKey();
  if (!encoded) return "missing";
  try {
    return Buffer.from(encoded, "base64").length === 32 ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}

function encryptionKey() {
  const encoded = encodedEncryptionKey();
  if (!encoded) throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY manquante.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY doit contenir 32 octets encodés en base64.");
  return key;
}

export function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptToken(payload: string) {
  const [ivValue, tagValue, encryptedValue] = payload.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("Jeton chiffré invalide.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
