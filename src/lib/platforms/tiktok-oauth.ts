import type { ConnectionTokens } from "@/actions/platform-connections";

/**
 * TikTok Login Kit (v2) authorization-code helpers for US-021's "connect account"
 * flow. Deliberately pure: no database access and no Next.js imports, so the route
 * handlers stay thin and these two functions are unit-testable with an injected
 * fetch.
 *
 * Written without live API access, so the request/response shapes below follow the
 * documented standard and are marked as assumptions to re-verify against real
 * traffic (same convention as TikTokAdapter in ./tiktok.ts).
 */

const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_API_BASE = "https://open.tiktokapis.com";

/**
 * ASSUMPTION (verify against live API): these are the only two scopes the pipeline
 * needs — `user.info.basic` to resolve the connected account, `video.publish` for
 * the PULL_FROM_URL posting the adapter does. TikTok rejects the authorize request
 * outright if a scope is not enabled on the app in the developer portal.
 */
const TIKTOK_SCOPES = "user.info.basic,video.publish";

/**
 * ASSUMPTION (verify against live API): the v2 token endpoint answers with flat
 * fields and, on failure, a *string* `error` plus `error_description` — unlike the
 * Content Posting endpoints, which nest an error object. Mirrors the envelope
 * modelled in ./tiktok.ts.
 */
interface TikTokTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  token_type?: string;
  error?: string | { code?: string; message?: string };
  error_description?: string;
}

function extractError(body: TikTokTokenResponse | null): { code?: string; message?: string } {
  if (!body) return {};
  if (typeof body.error === "string") {
    return { code: body.error, message: body.error_description };
  }
  return { code: body.error?.code, message: body.error?.message };
}

function isOkCode(code: string | undefined): boolean {
  // The OAuth endpoint omits `error` entirely on success; the Content Posting API
  // returns the literal "ok". Accept both so one parser covers either shape.
  return code === undefined || code === "ok";
}

export interface TikTokOAuthOptions {
  /** OAuth app credentials. Fall back to env, same convention as TikTokAdapter. */
  clientKey?: string;
  clientSecret?: string;
  baseUrl?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Builds the URL we redirect the operator's browser to in order to start the
 * TikTok consent flow. `state` should come from createOAuthState() so the callback
 * can verify the round trip; `redirectUri` must exactly match the one registered
 * in the TikTok developer portal and the one sent to the token endpoint later.
 */
export function buildTikTokAuthorizeUrl(
  state: string,
  redirectUri: string,
  options: Pick<TikTokOAuthOptions, "clientKey"> = {},
): string {
  const clientKey = options.clientKey ?? process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) {
    throw new Error("TIKTOK_CLIENT_KEY is not set");
  }

  const url = new URL(TIKTOK_AUTHORIZE_URL);
  // ASSUMPTION (verify against live API): v2 Login Kit names the app id param
  // `client_key` (not `client_id`) here as well as on the token endpoint.
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("scope", TIKTOK_SCOPES);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Exchanges the one-time authorization code TikTok hands back on the callback for
 * a token set. Returns ConnectionTokens ready for saveConnectionTokens() — this
 * function never touches the database or encrypts anything itself.
 *
 * Throws a plain Error (not one of the typed PlatformErrors) on any failure: a bad
 * exchange is a user-facing "connection failed", not a publish-pipeline condition,
 * and the callback route turns it into a `connection_error=tiktok` redirect.
 */
export async function exchangeTikTokCode(
  code: string,
  redirectUri: string,
  options: TikTokOAuthOptions = {},
): Promise<ConnectionTokens> {
  const clientKey = options.clientKey ?? process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = options.clientSecret ?? process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not set");
  }

  const baseUrl = options.baseUrl ?? TIKTOK_API_BASE;
  const fetchImpl = options.fetchImpl ?? fetch;

  // ASSUMPTION (verify against live API): the v2 token endpoint takes
  // form-urlencoded (not JSON), same as the refresh_token grant in ./tiktok.ts.
  const form = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const response = await fetchImpl(`${baseUrl}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  let body: TikTokTokenResponse | null = null;
  try {
    body = (await response.json()) as TikTokTokenResponse;
  } catch {
    // A non-JSON body (gateway HTML, empty 204) is not fatal on its own — the
    // checks below decide what it means.
    body = null;
  }

  const { code: errorCode, message } = extractError(body);

  if (!response.ok || !isOkCode(errorCode)) {
    const detail = [errorCode, message].filter(Boolean).join(": ") || `HTTP ${response.status}`;
    throw new Error(`TikTok code exchange failed (HTTP ${response.status}): ${detail}`);
  }

  if (!body?.access_token) {
    throw new Error("TikTok code exchange returned no access_token");
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 0) * 1000),
    externalAccountId: body.open_id ?? null,
  };
}
