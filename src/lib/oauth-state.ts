import { randomUUID } from "crypto";

/** Cookie name shared by every /api/auth/{platform}/authorize + callback pair. */
export const OAUTH_STATE_COOKIE = "oauth_state_nonce";

export class OAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthStateError";
  }
}

/**
 * Builds the `state` param for an OAuth authorize redirect: the niche being connected
 * plus a random nonce, base64url-encoded as JSON. The nonce is also set as an httpOnly
 * cookie (OAUTH_STATE_COOKIE) on the redirect response -- a standard double-submit
 * pattern that lets the callback route confirm the state round-tripped through the same
 * browser that started the flow, without this app needing a server-side session store.
 */
export function createOAuthState(nicheId: string): { state: string; nonce: string } {
  const nonce = randomUUID();
  const state = Buffer.from(JSON.stringify({ nicheId, nonce })).toString("base64url");
  return { state, nonce };
}

/**
 * Decodes `state` and verifies its nonce matches the cookie set by createOAuthState.
 * Throws OAuthStateError on anything malformed or mismatched -- callers should turn that
 * into a 400 and must never proceed to a token exchange without this succeeding.
 */
export function verifyOAuthState(state: string | null, cookieNonce: string | undefined): { nicheId: string } {
  if (!state || !cookieNonce) {
    throw new OAuthStateError("Missing OAuth state or nonce cookie");
  }

  let decoded: { nicheId?: unknown; nonce?: unknown };
  try {
    decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    throw new OAuthStateError("Malformed OAuth state");
  }

  if (typeof decoded.nicheId !== "string" || typeof decoded.nonce !== "string" || decoded.nonce !== cookieNonce) {
    throw new OAuthStateError("OAuth state/nonce mismatch");
  }

  return { nicheId: decoded.nicheId };
}
