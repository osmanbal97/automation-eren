import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Symmetric encryption for OAuth tokens at rest (platform_connections'
 * access_token_encrypted / refresh_token_encrypted columns from US-002).
 *
 * AES-256-GCM, so ciphertext is authenticated -- a tampered or truncated value
 * fails to decrypt rather than silently yielding garbage we'd then send to a
 * platform API. The stored format is `v1:<iv>:<authTag>:<ciphertext>`, all
 * base64url, with the version prefix so a future key rotation or algorithm
 * change can be detected instead of misparsed.
 */

const FORMAT_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const KEY_BYTES = 32; // AES-256

export class TokenEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenEncryptionError";
  }
}

/**
 * Reads and validates the encryption key from TOKEN_ENCRYPTION_KEY, which must
 * be 32 bytes encoded as base64 or hex. Resolved per call rather than cached at
 * module load so tests (and Vercel's per-invocation env) can vary it.
 */
function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new TokenEncryptionError("TOKEN_ENCRYPTION_KEY is not set");
  }

  const decoded = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (decoded.length !== KEY_BYTES) {
    throw new TokenEncryptionError(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${decoded.length}`,
    );
  }
  return decoded;
}

/** Encrypts a token for storage. Returns the `v1:iv:tag:ciphertext` envelope. */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

/** Reverses encryptToken. Throws TokenEncryptionError on any malformed or tampered input. */
export function decryptToken(envelope: string): string {
  const parts = envelope.split(":");
  if (parts.length !== 4) {
    throw new TokenEncryptionError("Malformed encrypted token envelope");
  }

  const [version, ivPart, tagPart, ciphertextPart] = parts;
  if (version !== FORMAT_VERSION) {
    throw new TokenEncryptionError(`Unsupported token envelope version "${version}"`);
  }

  const key = getKey();
  const iv = Buffer.from(ivPart, "base64url");
  const authTag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");

  if (iv.length !== IV_BYTES) {
    throw new TokenEncryptionError("Malformed encrypted token envelope");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // GCM auth failure (wrong key, tampered ciphertext) surfaces as an opaque
    // error -- re-wrap it so callers get one typed error for every failure mode.
    throw new TokenEncryptionError("Failed to decrypt token (wrong key or tampered value)");
  }
}

/** Convenience for nullable DB columns: null/undefined passes straight through. */
export function decryptTokenOrNull(envelope: string | null | undefined): string | null {
  return envelope ? decryptToken(envelope) : null;
}
