import type { ErrorLogStore } from "@/lib/error-log";
import { callWithRetry } from "@/lib/resilient-client";
import {
  PlatformAuthError,
  PlatformNotApprovedError,
  PlatformPublishError,
  type PlatformAdapter,
  type PlatformCredentials,
  type PublishPayload,
  type PublishResult,
  type RefreshedCredentials,
} from "./types";

/**
 * TikTok Content Posting API (v2) adapter — PULL_FROM_URL flow, where we hand
 * TikTok a public Blob URL (US-003) and it fetches the file itself, so we never
 * stream bytes through our own serverless function.
 *
 * Written without live API access, so every response shape below is the
 * documented-standard one and is marked as an assumption to re-verify against
 * real traffic (same convention as HiggsfieldProvider.normalizeStatus).
 */

const TIKTOK_API_BASE = "https://open.tiktokapis.com";

/**
 * TikTok's four documented privacy levels. Pre-audit apps may only post
 * SELF_ONLY (private to the creator), which is what we default to.
 */
export type TikTokPrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

/**
 * ASSUMPTION (verify against live API): TikTok signals "your app/account has not
 * cleared audit" through these `error.code` values. Anything here becomes a
 * PlatformNotApprovedError so the publish worker parks the post as
 * awaiting_platform_approval instead of burning retries.
 */
const AUDIT_ERROR_CODES = new Set([
  "unaudited_client_can_only_post_to_private_accounts",
  "unaudited_client_fail_to_post_to_public_accounts",
  "url_ownership_unverified",
]);

/**
 * ASSUMPTION (verify against live API): auth failures that a token refresh
 * cannot repair — a revoked token or a scope the connection never had. Note
 * `access_token_invalid` is deliberately NOT here: an expired access token is
 * exactly the refreshable case, and the caller is expected to call
 * refreshCredentials and retry.
 */
const AUTH_ERROR_CODES = new Set([
  "scope_not_authorized",
  "scope_permission_missed",
  "invalid_grant",
  "invalid_request",
]);

/** Expired-but-refreshable access token. Surfaced as PlatformAuthError too, but named for clarity. */
const REFRESHABLE_ERROR_CODES = new Set(["access_token_invalid", "access_token_expired"]);

/**
 * ASSUMPTION (verify against live API): TikTok sometimes answers HTTP 200 with a
 * rate-limit error in the envelope rather than an HTTP 429. We re-map those onto
 * 429 before handing the attempt to callWithRetry so backoff still kicks in.
 */
const RETRYABLE_ERROR_CODES = new Set(["rate_limit_exceeded", "internal_error", "spam_risk_too_many_posts"]);

/** TikTok caps the post title/caption; longer values are rejected outright. */
const MAX_TITLE_LENGTH = 2200;

interface TikTokErrorObject {
  code?: string;
  message?: string;
  log_id?: string;
}

/**
 * ASSUMPTION (verify against live API): the Content Posting endpoints wrap
 * everything in `{ data, error: { code: "ok", ... } }`, while the OAuth token
 * endpoint returns its fields flat with a *string* `error` on failure. This
 * envelope models both so one parser covers the whole adapter.
 */
interface TikTokEnvelope<T> {
  data?: T;
  error?: TikTokErrorObject | string;
  error_description?: string;
}

interface TikTokPublishInitData {
  publish_id?: string;
  upload_url?: string;
}

interface TikTokTokenResponse extends TikTokEnvelope<never> {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  token_type?: string;
}

/** One HTTP attempt, normalized so callWithRetry can see a single `status` to judge. */
interface TikTokAttempt<T> {
  /** Effective status used for retry decisions (may be re-mapped from the envelope). */
  status: number;
  /** The status the server actually returned. */
  httpStatus: number;
  body: T | null;
}

function extractError(body: TikTokEnvelope<unknown> | null): { code?: string; message?: string } {
  if (!body) return {};
  if (typeof body.error === "string") {
    return { code: body.error, message: body.error_description };
  }
  return { code: body.error?.code, message: body.error?.message };
}

function isOkCode(code: string | undefined): boolean {
  // The Content Posting API returns the literal "ok"; the OAuth endpoint omits
  // `error` entirely on success.
  return code === undefined || code === "ok";
}

/** Renders caption + hashtags into TikTok's single `title` field. */
export function buildTikTokTitle(caption: string, hashtags: string[]): string {
  const tags = hashtags
    .map((tag) => tag.trim().replace(/^#+/, ""))
    .filter((tag) => tag.length > 0)
    .map((tag) => `#${tag}`);
  return [caption.trim(), ...tags].filter((part) => part.length > 0).join(" ").slice(0, MAX_TITLE_LENGTH);
}

export interface TikTokAdapterOptions {
  /** OAuth app credentials, needed only by refreshCredentials. Falls back to env. */
  clientKey?: string;
  clientSecret?: string;
  baseUrl?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  errorLogStore?: ErrorLogStore;
  /**
   * Whether TikTok has approved the app for public posting. Defaults to false —
   * the safe pre-audit posture — which pins every post to SELF_ONLY so we cannot
   * accidentally trip the unaudited-client rejection while in sandbox.
   */
  auditPassed?: boolean;
  /** Explicit override; ignored (forced to SELF_ONLY) while auditPassed is false. */
  privacyLevel?: TikTokPrivacyLevel;
  /** Injectable clock, so the computed token expiry is deterministic in tests. */
  now?: () => Date;
  /** Retry tuning, passed straight through to callWithRetry — mainly for fast, deterministic tests. */
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class TikTokAdapter implements PlatformAdapter {
  readonly platform = "tiktok" as const;

  private readonly clientKey?: string;
  private readonly clientSecret?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly errorLogStore?: ErrorLogStore;
  private readonly auditPassed: boolean;
  private readonly configuredPrivacyLevel: TikTokPrivacyLevel;
  private readonly now: () => Date;
  private readonly maxAttempts?: number;
  private readonly baseDelayMs?: number;
  private readonly sleep?: (ms: number) => Promise<void>;
  private readonly random?: () => number;

  constructor(options: TikTokAdapterOptions = {}) {
    this.clientKey = options.clientKey ?? process.env.TIKTOK_CLIENT_KEY;
    this.clientSecret = options.clientSecret ?? process.env.TIKTOK_CLIENT_SECRET;
    this.baseUrl = options.baseUrl ?? TIKTOK_API_BASE;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.errorLogStore = options.errorLogStore;
    this.auditPassed = options.auditPassed ?? false;
    this.configuredPrivacyLevel = options.privacyLevel ?? "PUBLIC_TO_EVERYONE";
    this.now = options.now ?? (() => new Date());
    this.maxAttempts = options.maxAttempts;
    this.baseDelayMs = options.baseDelayMs;
    this.sleep = options.sleep;
    this.random = options.random;
  }

  /** SELF_ONLY until the app clears audit, whatever the caller configured. */
  get privacyLevel(): TikTokPrivacyLevel {
    return this.auditPassed ? this.configuredPrivacyLevel : "SELF_ONLY";
  }

  private async request<T extends TikTokEnvelope<unknown>>(
    path: string,
    init: RequestInit,
    operation: string,
  ): Promise<TikTokAttempt<T>> {
    return callWithRetry<TikTokAttempt<T>>({
      provider: "tiktok",
      operation,
      execute: async () => {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);

        let body: T | null = null;
        try {
          body = (await response.json()) as T;
        } catch {
          // A non-JSON body (gateway HTML, empty 204) is not fatal on its own —
          // the status check below decides what it means.
          body = null;
        }

        const { code } = extractError(body);
        const status =
          response.ok && code !== undefined && RETRYABLE_ERROR_CODES.has(code) ? 429 : response.status;

        return { status, httpStatus: response.status, body };
      },
      errorLogStore: this.errorLogStore,
      payloadSummary: `${init.method ?? "GET"} ${path}`,
      maxAttempts: this.maxAttempts,
      baseDelayMs: this.baseDelayMs,
      sleep: this.sleep,
      random: this.random,
    });
  }

  /** Translates a completed attempt into one of the three typed platform errors. */
  private assertOk<T extends TikTokEnvelope<unknown>>(attempt: TikTokAttempt<T>, operation: string): T {
    const { code, message } = extractError(attempt.body);
    const detail = message ?? code ?? `HTTP ${attempt.httpStatus}`;

    if (code !== undefined && AUDIT_ERROR_CODES.has(code)) {
      throw new PlatformNotApprovedError(
        "tiktok",
        `TikTok has not approved this app/account for posting: ${detail}`,
      );
    }

    if (code !== undefined && (AUTH_ERROR_CODES.has(code) || REFRESHABLE_ERROR_CODES.has(code))) {
      throw new PlatformAuthError("tiktok", `TikTok rejected the credentials during ${operation}: ${detail}`);
    }

    if (attempt.httpStatus === 401 || attempt.httpStatus === 403) {
      throw new PlatformAuthError("tiktok", `TikTok rejected the credentials during ${operation}: ${detail}`);
    }

    const httpOk = attempt.httpStatus >= 200 && attempt.httpStatus < 300;
    if (!httpOk || !isOkCode(code) || attempt.body === null) {
      throw new PlatformPublishError(
        "tiktok",
        operation,
        attempt.httpStatus,
        `TikTok ${operation} failed (HTTP ${attempt.httpStatus}): ${detail}`,
      );
    }

    return attempt.body;
  }

  async publish(payload: PublishPayload, credentials: PlatformCredentials): Promise<PublishResult> {
    const attempt = await this.request<TikTokEnvelope<TikTokPublishInitData>>(
      "/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          post_info: {
            title: buildTikTokTitle(payload.caption, payload.hashtags),
            privacy_level: this.privacyLevel,
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: payload.videoUrl,
          },
        }),
      },
      "publish",
    );

    const body = this.assertOk(attempt, "publish");

    // ASSUMPTION (verify against live API): the init response carries
    // `data.publish_id`, which is the id we persist as platform_post_id. TikTok
    // treats it as the handle for the whole publish, including status polling.
    const publishId = body.data?.publish_id;
    if (!publishId) {
      throw new PlatformPublishError(
        "tiktok",
        "publish",
        attempt.httpStatus,
        "TikTok accepted the publish init but returned no publish_id",
      );
    }

    return { platformPostId: publishId };
  }

  /**
   * TikTok access tokens live 24h, so this runs often. Returns the new values
   * for the caller to encrypt + persist onto platform_connections — the adapter
   * never touches the database itself.
   */
  async refreshCredentials(credentials: PlatformCredentials): Promise<RefreshedCredentials> {
    if (!credentials.refreshToken) {
      throw new PlatformAuthError("tiktok", "No TikTok refresh token stored for this connection");
    }
    if (!this.clientKey || !this.clientSecret) {
      throw new Error("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not set");
    }

    // ASSUMPTION (verify against live API): the v2 token endpoint takes
    // form-urlencoded (not JSON) and answers with flat fields.
    const form = new URLSearchParams({
      client_key: this.clientKey,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    });

    const attempt = await this.request<TikTokTokenResponse>(
      "/v2/oauth/token/",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
      "refreshCredentials",
    );

    const body = this.assertOk(attempt, "refreshCredentials");

    if (!body.access_token) {
      throw new PlatformAuthError("tiktok", "TikTok token refresh returned no access_token");
    }

    return {
      accessToken: body.access_token,
      // TikTok rotates the refresh token on each exchange; keep the old one if
      // it did not send a replacement.
      refreshToken: body.refresh_token ?? credentials.refreshToken,
      expiresAt:
        body.expires_in === undefined
          ? null
          : new Date(this.now().getTime() + body.expires_in * 1000),
    };
  }
}
