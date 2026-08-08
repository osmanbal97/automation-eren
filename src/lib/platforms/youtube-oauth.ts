import type { ConnectionTokens } from "@/actions/platform-connections";

/**
 * Google/YouTube authorization-code helpers for US-023's "connect account" flow.
 * Deliberately pure: no database access and no Next.js imports, so the route
 * handlers stay thin and these two functions are unit-testable with an injected
 * fetch.
 *
 * Written without live API access, so the request/response shapes below follow the
 * documented standard and are marked as assumptions to re-verify against real
 * traffic (same convention as YouTubeAdapter in ./youtube.ts).
 */

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true";

/**
 * ASSUMPTION (verify against live API): these are the only two scopes the pipeline
 * needs — `youtube.upload` for the resumable videos.insert the adapter performs, and
 * `youtube.readonly` to resolve the connected channel id via channels?mine=true.
 * Space-separated, per the OAuth 2.0 spec (URLSearchParams encodes the spaces).
 * Both are "sensitive/restricted" scopes, so the OAuth consent screen must be
 * verified by Google before non-test users can complete this flow.
 */
const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

/**
 * ASSUMPTION (verify against live API): error bodies follow the documented Google
 * JSON API error envelope — `{ error: { code, message, status, errors: [...] } }` —
 * while the OAuth token endpoint uses a flatter `{ error, error_description }`
 * shape. Both are read defensively here, mirroring ./youtube.ts.
 */
interface GoogleErrorBody {
  error?:
    | string
    | {
        code?: number;
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string; domain?: string; message?: string }>;
      };
  /** The OAuth token endpoint uses a flatter shape than the Data API. */
  error_description?: string;
}

/** ASSUMPTION: standard OAuth 2.0 token response from https://oauth2.googleapis.com/token. */
interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

/**
 * ASSUMPTION (verify against live API): channels.list with `part=id&mine=true`
 * answers `{ items: [{ id: "<channel_id>" }] }`. A Google account with no YouTube
 * channel comes back with an empty (or absent) `items` array rather than an error.
 */
interface YouTubeChannelListResponse {
  items?: Array<{ id?: string }>;
}

export interface YouTubeOAuthOptions {
  /** OAuth app credentials. Fall back to env, same convention as YouTubeAdapter. */
  clientId?: string;
  clientSecret?: string;
  /** Base for the OAuth token endpoint; overridable for tests. */
  tokenUrl?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Pulls the most useful human-readable detail out of either Google error shape. */
function describeError(body: GoogleErrorBody | null, status: number): string {
  if (!body) return `HTTP ${status}`;
  const nested = typeof body.error === "object" && body.error !== null ? body.error : undefined;
  const code = typeof body.error === "string" ? body.error : nested?.status ?? nested?.errors?.[0]?.reason;
  const message = nested?.message ?? nested?.errors?.[0]?.message ?? body.error_description;
  return [code, message].filter(Boolean).join(": ") || `HTTP ${status}`;
}

async function readBody<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    // A non-JSON body (gateway HTML, empty 204) is not fatal on its own — the
    // callers below decide what it means.
    return null;
  }
}

/**
 * Builds the URL we redirect the operator's browser to in order to start the Google
 * consent flow. `state` should come from createOAuthState() so the callback can
 * verify the round trip; `redirectUri` must exactly match one of the authorized
 * redirect URIs registered on the OAuth client and the one sent to the token
 * endpoint later.
 */
export function buildYouTubeAuthorizeUrl(
  state: string,
  redirectUri: string,
  options: Pick<YouTubeOAuthOptions, "clientId"> = {},
): string {
  const clientId = options.clientId ?? process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is not set");
  }

  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_SCOPES);
  // Required to receive a refresh_token at all: without offline access Google only
  // issues a short-lived access token and the publish worker could never refresh.
  url.searchParams.set("access_type", "offline");
  // Forces Google to re-issue a refresh_token even when the operator has already
  // authorized this app. Without it, a repeat connect silently omits refresh_token
  // and we'd persist a connection that dies in an hour.
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Exchanges the one-time authorization code Google hands back on the callback for a
 * token set, then resolves the connected channel's id so posts can be attributed.
 * Returns ConnectionTokens ready for saveConnectionTokens() — this function never
 * touches the database or encrypts anything itself.
 *
 * A missing `refresh_token` is *not* treated as a failure: Google legitimately omits
 * it on some flows (e.g. a re-authorization where the earlier grant is still live).
 * The token set is stored with `refreshToken: null` in that case; the connection
 * still works until the access token expires, and reconnecting with `prompt=consent`
 * (which buildYouTubeAuthorizeUrl always sets) restores a refresh token.
 *
 * Throws a plain Error (not one of the typed PlatformErrors) on any failure: a bad
 * exchange is a user-facing "connection failed", not a publish-pipeline condition,
 * and the callback route turns it into a `connection_error=youtube` redirect.
 */
export async function exchangeYouTubeCode(
  code: string,
  redirectUri: string,
  options: YouTubeOAuthOptions = {},
): Promise<ConnectionTokens> {
  const clientId = options.clientId ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = options.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  }

  const tokenUrl = options.tokenUrl ?? GOOGLE_TOKEN_URL;
  const fetchImpl = options.fetchImpl ?? fetch;

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const tokenResponse = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!tokenResponse.ok) {
    const body = await readBody<GoogleErrorBody>(tokenResponse);
    throw new Error(
      `YouTube code exchange failed (HTTP ${tokenResponse.status}): ${describeError(body, tokenResponse.status)}`,
    );
  }

  const token = await readBody<GoogleTokenResponse>(tokenResponse);
  if (!token?.access_token) {
    throw new Error("YouTube code exchange returned no access_token");
  }

  // Second call: the token alone doesn't tell us which channel we're connected to,
  // and every later publish/attribution needs that id.
  const channelsResponse = await fetchImpl(YOUTUBE_CHANNELS_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  if (!channelsResponse.ok) {
    const body = await readBody<GoogleErrorBody>(channelsResponse);
    throw new Error(
      `YouTube channel lookup failed (HTTP ${channelsResponse.status}): ${describeError(body, channelsResponse.status)}`,
    );
  }

  const channels = await readBody<YouTubeChannelListResponse>(channelsResponse);
  const channelId = channels?.items?.[0]?.id;
  if (!channelId) {
    throw new Error("No YouTube channel found for this Google account");
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (token.expires_in ?? 0) * 1000),
    externalAccountId: channelId,
  };
}
