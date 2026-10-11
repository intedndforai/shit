import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * At-rest encryption for API keys. Keys are encrypted with AES-256-GCM using
 * a key derived from the ENCRYPTION_KEY env secret (SHA-256). The random IV
 * and GCM auth tag travel with the ciphertext. Secrets are never logged.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function derivedKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY is not set. Add it to your .env file.");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptText(plaintext: string): { ciphertext: string; iv: string } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, derivedKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, authTag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}

export function decryptText(ciphertextB64: string, ivB64: string): string {
  const payload = Buffer.from(ciphertextB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = payload.subarray(payload.length - 16);
  const data = payload.subarray(0, payload.length - 16);
  const decipher = createDecipheriv(ALGORITHM, derivedKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Display form that never reveals the full secret. */
export function maskSecret(secret: string | null | undefined): string {
  if (!secret) return "";
  if (secret.length <= 4) return "••••";
  return `••••${secret.slice(-4)}`;
}