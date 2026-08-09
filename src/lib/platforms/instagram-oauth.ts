import type { ConnectionTokens } from "@/actions/platform-connections";

/**
 * Meta's OAuth "connect account" helpers for Instagram (US-022).
 *
 * Kept deliberately free of database access and Next.js imports so the whole
 * exchange is unit-testable against a mocked fetch, exactly like
 * `instagram.ts`'s adapter. The route handlers under
 * `src/app/api/auth/instagram/**` stay thin wrappers over these functions.
 *
 * Note that `InstagramAdapter` has no `refreshCredentials`: Meta does not issue
 * refresh tokens. Instead a short-lived user token is swapped for a *long-lived*
 * one via the `fb_exchange_token` grant, which is what `exchangeInstagramCode`
 * performs below.
 */

const DEFAULT_BASE_URL = "https://graph.facebook.com";
const DEFAULT_API_VERSION = "v21.0";

/**
 * Where the user is sent to approve the app. This is the www.facebook.com
 * dialog host, not the graph.facebook.com API host — only the token exchange
 * calls hit the Graph base URL.
 */
const DIALOG_HOST = "https://www.facebook.com";

/**
 * Scopes requested at authorize time.
 * ASSUMPTION (verify against live API): `instagram_basic` +
 * `instagram_content_publish` cover reading the IG business account and
 * publishing Reels, while `pages_show_list` + `business_management` are what
 * `/me/accounts` needs to enumerate the Pages the IG account hangs off. All
 * four require Meta app review before they work for non-test users.
 */
const INSTAGRAM_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "business_management",
].join(",");

/**
 * Fallback lifetime for a long-lived user token when Meta omits `expires_in`.
 * ASSUMPTION (verify against live API): Meta documents long-lived user tokens
 * as ~60 days, so 5,184,000 seconds is the conservative default.
 */
const DEFAULT_LONG_LIVED_EXPIRES_IN_SECONDS = 5_184_000;

/** Standard Graph API error envelope: `{ "error": { message, type, code, ... } }`. */
interface GraphErrorEnvelope {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
  };
}

/** Shape returned by both `/oauth/access_token` calls (code exchange and fb_exchange_token). */
interface AccessTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

/** `GET /me/accounts` — the Pages this user administers. */
interface MeAccountsResponse {
  data?: Array<{ id?: string; name?: string }>;
}

/** `GET /{page-id}?fields=instagram_business_account`. */
interface PageInstagramAccountResponse {
  instagram_business_account?: { id?: string };
}

export interface BuildInstagramAuthorizeUrlOptions {
  clientId?: string;
  apiVersion?: string;
}

export interface ExchangeInstagramCodeOptions {
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
  apiVersion?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Builds the Facebook Login dialog URL the authorize route redirects the
 * operator to. `state` must come from `createOAuthState` so the callback can
 * verify the round trip.
 */
export function buildInstagramAuthorizeUrl(
  state: string,
  redirectUri: string,
  options: BuildInstagramAuthorizeUrlOptions = {},
): string {
  const clientId = options.clientId ?? process.env.META_APP_ID ?? "";
  const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: INSTAGRAM_SCOPES,
  });

  return `${DIALOG_HOST}/${apiVersion}/dialog/oauth?${params.toString()}`;
}

/**
 * Completes the Instagram connect flow in four Graph API GETs:
 *
 *   1. `/oauth/access_token` — authorization code -> short-lived user token.
 *   2. `/oauth/access_token?grant_type=fb_exchange_token` — short-lived ->
 *      long-lived (~60 day) user token. This is Meta's stand-in for a refresh
 *      grant, which is why no refresh token comes back.
 *   3. `/me/accounts` — the Pages the user administers; we take the first.
 *   4. `/{page-id}?fields=instagram_business_account` — the IG user id that
 *      `InstagramAdapter` needs as `externalAccountId`.
 *
 * KNOWN FOLLOW-UP: the long-lived token still expires (~60 days) and this app
 * does not yet re-exchange it before expiry — reconnecting the account is
 * currently the only remedy. Out of scope for US-022.
 *
 * Throws a plain `Error` (never a typed PlatformError) on any non-OK response
 * or Graph error envelope, so the callback route can uniformly redirect back
 * with `connection_error=instagram`.
 */
export async function exchangeInstagramCode(
  code: string,
  redirectUri: string,
  options: ExchangeInstagramCodeOptions = {},
): Promise<ConnectionTokens> {
  const clientId = options.clientId ?? process.env.META_APP_ID ?? "";
  const clientSecret = options.clientSecret ?? process.env.META_APP_SECRET ?? "";
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
  const fetchImpl = options.fetchImpl ?? fetch;

  const endpoint = (path: string, params: Record<string, string>): string =>
    `${baseUrl}/${apiVersion}${path}?${new URLSearchParams(params).toString()}`;

  // Step 1: authorization code -> short-lived user access token.
  const shortLived = await requestJson<AccessTokenResponse>(
    fetchImpl,
    endpoint("/oauth/access_token", {
      client_id: clientId,
      redirect_uri: redirectUri,
      client_secret: clientSecret,
      code,
    }),
    "authorization code exchange",
  );

  if (!shortLived?.access_token) {
    throw new Error("Instagram authorization code exchange returned no access token");
  }

  // Step 2: short-lived -> long-lived (~60 day) user access token.
  const longLived = await requestJson<AccessTokenResponse>(
    fetchImpl,
    endpoint("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: shortLived.access_token,
    }),
    "long-lived token exchange",
  );

  if (!longLived?.access_token) {
    throw new Error("Instagram long-lived token exchange returned no access token");
  }

  const accessToken = longLived.access_token;

  // Step 3: find the Page the Instagram Business Account is linked to.
  // ASSUMPTION (verify against live API): one niche == one Page, so taking the
  // first entry in `data` is fine. A multi-Page operator would need a picker UI.
  const accounts = await requestJson<MeAccountsResponse>(
    fetchImpl,
    endpoint("/me/accounts", { access_token: accessToken }),
    "page lookup",
  );

  const pageId = accounts?.data?.[0]?.id;
  if (!pageId) {
    throw new Error(
      "No Facebook Page connected to this account. Link the Instagram Business Account to a Page, then reconnect.",
    );
  }

  // Step 4: resolve the IG user id the Content Publishing API addresses.
  const page = await requestJson<PageInstagramAccountResponse>(
    fetchImpl,
    endpoint(`/${pageId}`, {
      fields: "instagram_business_account",
      access_token: accessToken,
    }),
    "business account lookup",
  );

  const igUserId = page?.instagram_business_account?.id;
  if (!igUserId) {
    throw new Error(
      "Connected Page has no linked Instagram Business Account. Convert the account to Business/Creator and link it to the Page, then reconnect.",
    );
  }

  const expiresInSeconds = longLived.expires_in ?? DEFAULT_LONG_LIVED_EXPIRES_IN_SECONDS;

  return {
    accessToken,
    // Meta issues no refresh token; the fb_exchange_token grant above is the
    // closest equivalent and has to be re-run manually before expiry.
    refreshToken: null,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    externalAccountId: igUserId,
  };
}

/**
 * One Graph API GET, with the same error-envelope parsing `instagram.ts` does —
 * but flattened to a plain `Error` since OAuth failures are surfaced to the
 * operator as a redirect, not retried by the publish worker.
 */
async function requestJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  operation: string,
): Promise<T> {
  const response = await fetchImpl(url, { method: "GET" });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // Meta occasionally returns an empty or HTML body on gateway errors.
    body = undefined;
  }

  const graphError = (body as GraphErrorEnvelope | undefined)?.error;

  if (!response.ok || graphError) {
    const detail = graphError?.error_user_msg ?? graphError?.message ?? `HTTP ${response.status}`;
    throw new Error(`Instagram ${operation} failed (HTTP ${response.status}): ${detail}`);
  }

  return body as T;
}
