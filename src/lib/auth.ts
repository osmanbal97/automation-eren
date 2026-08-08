// Uses Web Crypto (globalThis.crypto.subtle) rather than node:crypto so this
// module works unmodified in both the Edge middleware runtime and Node.js
// API routes — no experimental Node-middleware config needed.

const SESSION_COOKIE_NAME = "session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SESSION_VALUE = "ok";

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET env var is not set");
  }
  return secret;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  // Constant-time-ish comparison: XOR every char code, only branch at the end.
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toHex(signature);
}

/**
 * Builds the signed cookie value used to represent an authenticated session.
 * Format: "<expiresAtEpochSeconds>.<hmacSignature>"
 */
export async function createSessionCookieValue(): Promise<string> {
  const secret = getAuthSecret();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `${SESSION_VALUE}.${expiresAt}`;
  const signature = await sign(payload, secret);
  return `${expiresAt}.${signature}`;
}

/**
 * Verifies a session cookie value was signed by us and hasn't expired.
 */
export async function verifySessionCookieValue(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;

  const [expiresAtStr, signature] = cookieValue.split(".");
  if (!expiresAtStr || !signature) return false;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
    return false;
  }

  let secret: string;
  try {
    secret = getAuthSecret();
  } catch {
    return false;
  }

  const payload = `${SESSION_VALUE}.${expiresAtStr}`;
  const expectedSignature = await sign(payload, secret);

  return timingSafeEqualHex(expectedSignature, signature);
}

export function verifyPassword(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    throw new Error("APP_PASSWORD env var is not set");
  }
  if (candidate.length !== expected.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < candidate.length; i++) {
    mismatch |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export const SESSION_COOKIE = {
  name: SESSION_COOKIE_NAME,
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
};
