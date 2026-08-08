import type { ErrorLogStore } from "@/lib/error-log";
import { checkQuota, recordUsage, type QuotaStore } from "@/lib/quota";
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
 * A single videos.insert call costs 1600 quota units against the Data API's
 * default 10,000 units/day project quota — so roughly six uploads a day before
 * we're blocked. That makes the pre-check in `publish` mandatory rather than
 * nice-to-have.
 */
export const YOUTUBE_UPLOAD_QUOTA_UNITS = 1600;
export const YOUTUBE_DEFAULT_DAILY_QUOTA = 10_000;

/** Provider key used for both quota counters and error_logs rows. */
const PROVIDER = "youtube";

/** YouTube rejects snippet.title over 100 characters outright. */
const MAX_TITLE_LENGTH = 100;
/** YouTube rejects snippet.description over 5000 characters outright. */
const MAX_DESCRIPTION_LENGTH = 5000;

/**
 * YouTube told us we're out of quota (403 + reason "quotaExceeded"). Distinct
 * from a generic publish failure so the publish worker (US-024) can defer the
 * post to tomorrow instead of burning its retry budget on a call that cannot
 * succeed again today. Kept separate from quota.ts's QuotaExceededError because
 * that one is our own local pre-check with known counters; this one is the
 * platform's verdict and carries no numbers we can trust.
 */
export class YouTubeQuotaExceededError extends Error {
  constructor(
    public readonly operation: string,
    public readonly reason: string,
    message?: string,
  ) {
    super(message ?? `YouTube rejected ${operation}: quota exhausted (reason: ${reason})`);
    this.name = "YouTubeQuotaExceededError";
  }
}

/**
 * ASSUMPTION (no live Google API access at implementation time): error bodies
 * follow the documented Google JSON API error envelope —
 * `{ error: { code, message, errors: [{ reason, domain }] } }` — and newer
 * responses may instead carry `error.status` / `error.details`. We read both
 * shapes defensively and fall back to a generic PlatformPublishError. Revisit
 * against real responses once the OAuth app is live.
 */
interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string; domain?: string; message?: string }>;
  };
  /** The OAuth token endpoint uses a flatter shape than the Data API. */
  error_description?: string;
}

/** ASSUMPTION: videos.insert returns the created resource with a top-level `id`. */
interface YouTubeVideoResource {
  id?: string;
}

/** ASSUMPTION: standard OAuth 2.0 token response from https://oauth2.googleapis.com/token. */
interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

/**
 * Reasons Google uses when the project has burned through its daily units. All
 * three mean "come back later", so the worker treats them identically.
 * ASSUMPTION: this list is from the published Data API error docs, not observed
 * traffic — widen it if we see other reasons in error_logs.
 */
const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"]);

/**
 * Reasons that mean the *account* isn't cleared to post yet (no channel, or the
 * OAuth app is still unverified for the upload scope) rather than a transient
 * failure — mapped onto PlatformNotApprovedError so US-020 can park the post.
 */
const NOT_APPROVED_REASONS = new Set([
  "youtubeSignupRequired",
  "unverifiedApp",
  "accessNotConfigured",
]);

export interface YouTubeAdapterOptions {
  /**
   * OAuth client credentials, only needed by refreshCredentials. Default to the
   * env vars the Google OAuth app is configured under (.env.example).
   */
  clientId?: string;
  clientSecret?: string;
  /** Base for the resumable upload endpoint; overridable for tests. */
  uploadBaseUrl?: string;
  /** Base for the OAuth token endpoint; overridable for tests. */
  tokenUrl?: string;
  /**
   * Daily unit budget to check against. Defaults to the standard 10,000/day
   * project quota; raise it here if we're ever granted an extension.
   */
  dailyQuotaCap?: number;
  /** Privacy of the uploaded Short. Defaults to public. */
  privacyStatus?: "public" | "unlisted" | "private";
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Required: daily quota counters. Inject an in-memory fake in tests. */
  quotaStore: QuotaStore;
  errorLogStore?: ErrorLogStore;
  /** Retry tuning, passed straight through to callWithRetry — mainly for fast, deterministic tests. */
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Injectable clock so refreshCredentials' expiresAt is deterministic in tests. */
  now?: () => Date;
}

/** "#cats" -> "cats"; YouTube's snippet.tags are bare keywords, not hashtags. */
function toTags(hashtags: string[]): string[] {
  return hashtags.map((tag) => tag.replace(/^#+/, "").trim()).filter((tag) => tag.length > 0);
}

/** YouTube has no single "caption" field: the first line becomes the title, the whole caption the description. */
function toTitle(caption: string): string {
  const firstLine = caption.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";
  const title = firstLine.length > 0 ? firstLine : "Untitled Short";
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

export class YouTubeAdapter implements PlatformAdapter {
  readonly platform = "youtube" as const;

  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly uploadBaseUrl: string;
  private readonly tokenUrl: string;
  private readonly dailyQuotaCap: number;
  private readonly privacyStatus: "public" | "unlisted" | "private";
  private readonly fetchImpl: typeof fetch;
  private readonly quotaStore: QuotaStore;
  private readonly errorLogStore?: ErrorLogStore;
  private readonly maxAttempts?: number;
  private readonly baseDelayMs?: number;
  private readonly sleep?: (ms: number) => Promise<void>;
  private readonly random?: () => number;
  private readonly now: () => Date;

  constructor(options: YouTubeAdapterOptions) {
    this.clientId = options.clientId ?? process.env.GOOGLE_CLIENT_ID;
    this.clientSecret = options.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET;
    this.uploadBaseUrl = options.uploadBaseUrl ?? "https://www.googleapis.com";
    this.tokenUrl = options.tokenUrl ?? "https://oauth2.googleapis.com/token";
    this.dailyQuotaCap = options.dailyQuotaCap ?? YOUTUBE_DEFAULT_DAILY_QUOTA;
    this.privacyStatus = options.privacyStatus ?? "public";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.quotaStore = options.quotaStore;
    this.errorLogStore = options.errorLogStore;
    this.maxAttempts = options.maxAttempts;
    this.baseDelayMs = options.baseDelayMs;
    this.sleep = options.sleep;
    this.random = options.random;
    this.now = options.now ?? (() => new Date());
  }

  private request(operation: string, payloadSummary: string, execute: () => Promise<Response>) {
    return callWithRetry({
      provider: PROVIDER,
      operation,
      execute,
      errorLogStore: this.errorLogStore,
      payloadSummary,
      maxAttempts: this.maxAttempts,
      baseDelayMs: this.baseDelayMs,
      sleep: this.sleep,
      random: this.random,
    });
  }

  private static async readErrorBody(response: Response): Promise<GoogleErrorBody> {
    try {
      return ((await response.json()) as GoogleErrorBody) ?? {};
    } catch {
      return {};
    }
  }

  /**
   * Turns a non-2xx response into the right typed error. 429/5xx never reach
   * here — callWithRetry has already retried and thrown RetryExhaustedError.
   */
  private async throwForResponse(response: Response, operation: string): Promise<never> {
    const body = await YouTubeAdapter.readErrorBody(response);
    const reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? "";
    const message = body.error?.message ?? body.error_description;

    if (response.status === 401) {
      throw new PlatformAuthError(
        PROVIDER,
        `YouTube rejected the access token during ${operation}${message ? `: ${message}` : ""}`,
      );
    }

    if (response.status === 403) {
      if (QUOTA_REASONS.has(reason)) {
        throw new YouTubeQuotaExceededError(operation, reason, message);
      }
      if (NOT_APPROVED_REASONS.has(reason)) {
        throw new PlatformNotApprovedError(
          PROVIDER,
          `YouTube is not cleared for uploads on this account (reason: ${reason})${message ? `: ${message}` : ""}`,
        );
      }
      // ASSUMPTION: a 403 with no recognizable reason usually means the token is
      // missing the youtube.upload scope, which is an auth problem, not a
      // retryable one. Revisit once we can see real 403 bodies.
      throw new PlatformAuthError(
        PROVIDER,
        `YouTube refused ${operation} (403${reason ? `, reason: ${reason}` : ""})${message ? `: ${message}` : ""}`,
      );
    }

    throw new PlatformPublishError(PROVIDER, operation, response.status, message);
  }

  /** Pulls the rendered video out of our own Blob storage so we can stream it to YouTube. */
  private async downloadVideo(videoUrl: string): Promise<ArrayBuffer> {
    const response = await this.request("downloadVideo", `GET ${videoUrl}`, () =>
      this.fetchImpl(videoUrl),
    );
    if (!response.ok) {
      throw new PlatformPublishError(
        PROVIDER,
        "downloadVideo",
        response.status,
        `Could not fetch the source video from ${videoUrl}`,
      );
    }
    return response.arrayBuffer();
  }

  /**
   * Step 1 of the resumable protocol: POST the metadata and get back a
   * single-use upload URL in the Location header.
   */
  private async initResumableUpload(
    payload: PublishPayload,
    credentials: PlatformCredentials,
    contentLength: number,
  ): Promise<string> {
    const url = `${this.uploadBaseUrl}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`;
    const body = {
      snippet: {
        title: toTitle(payload.caption),
        description: payload.caption.slice(0, MAX_DESCRIPTION_LENGTH),
        tags: toTags(payload.hashtags),
      },
      status: {
        privacyStatus: this.privacyStatus,
        // ASSUMPTION: required for any upload by an API client; Google rejects
        // the insert without it. Confirm the exact enum value against the live API.
        selfDeclaredMadeForKids: false,
      },
    };

    const response = await this.request("initResumableUpload", "POST /upload/youtube/v3/videos", () =>
      this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": "video/mp4",
          "X-Upload-Content-Length": String(contentLength),
        },
        body: JSON.stringify(body),
      }),
    );

    if (!response.ok) {
      await this.throwForResponse(response, "initResumableUpload");
    }

    const uploadUrl = response.headers?.get("Location") ?? response.headers?.get("location");
    if (!uploadUrl) {
      throw new PlatformPublishError(
        PROVIDER,
        "initResumableUpload",
        response.status,
        "YouTube accepted the resumable init but returned no Location upload URL",
      );
    }
    return uploadUrl;
  }

  /**
   * Step 2: PUT the bytes to the session URL. Google's protocol also supports
   * resuming a partial upload from a byte offset after a 308; we deliberately
   * retry the whole PUT instead, which is fine for ~10MB Shorts.
   * ASSUMPTION: revisit if we ever upload long-form video.
   */
  private async uploadVideoBytes(
    uploadUrl: string,
    credentials: PlatformCredentials,
    bytes: ArrayBuffer,
  ): Promise<string> {
    const response = await this.request("uploadVideoBytes", `PUT ${uploadUrl}`, () =>
      this.fetchImpl(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "video/mp4",
          "Content-Length": String(bytes.byteLength),
        },
        body: bytes,
      }),
    );

    if (!response.ok) {
      await this.throwForResponse(response, "uploadVideoBytes");
    }

    const created = (await response.json()) as YouTubeVideoResource;
    if (!created?.id) {
      throw new PlatformPublishError(
        PROVIDER,
        "uploadVideoBytes",
        response.status,
        "YouTube completed the upload but returned no video id",
      );
    }
    return created.id;
  }

  async publish(
    payload: PublishPayload,
    credentials: PlatformCredentials,
  ): Promise<PublishResult> {
    // Pre-check before any network call: an upload we know will be refused
    // shouldn't cost us a download, and the typed QuotaExceededError propagates
    // to the worker untouched so it can defer the post.
    await checkQuota(this.quotaStore, PROVIDER, YOUTUBE_UPLOAD_QUOTA_UNITS, this.dailyQuotaCap);

    const bytes = await this.downloadVideo(payload.videoUrl);
    const uploadUrl = await this.initResumableUpload(payload, credentials, bytes.byteLength);
    const platformPostId = await this.uploadVideoBytes(uploadUrl, credentials, bytes);

    await recordUsage(this.quotaStore, PROVIDER, YOUTUBE_UPLOAD_QUOTA_UNITS);

    return { platformPostId };
  }

  /**
   * Exchanges the stored refresh token for a fresh access token. Returns the new
   * values for the caller to persist onto platform_connections — adapters never
   * touch the database themselves.
   */
  async refreshCredentials(credentials: PlatformCredentials): Promise<RefreshedCredentials> {
    if (!credentials.refreshToken) {
      throw new PlatformAuthError(PROVIDER, "No stored refresh token for this YouTube connection");
    }
    if (!this.clientId || !this.clientSecret) {
      throw new PlatformAuthError(
        PROVIDER,
        "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not configured, cannot refresh the token",
      );
    }

    const response = await this.request("refreshCredentials", "POST oauth2 token", () =>
      this.fetchImpl(this.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId as string,
          client_secret: this.clientSecret as string,
          refresh_token: credentials.refreshToken as string,
          grant_type: "refresh_token",
        }).toString(),
      }),
    );

    if (!response.ok) {
      // A revoked/expired refresh token comes back as 400 invalid_grant, which
      // is an auth problem rather than a generic publish failure.
      const body = await YouTubeAdapter.readErrorBody(response);
      throw new PlatformAuthError(
        PROVIDER,
        `YouTube token refresh failed (HTTP ${response.status})${
          body.error_description ? `: ${body.error_description}` : ""
        }`,
      );
    }

    const token = (await response.json()) as GoogleTokenResponse;
    if (!token.access_token) {
      throw new PlatformAuthError(PROVIDER, "YouTube token refresh returned no access_token");
    }

    // ASSUMPTION: Google omits refresh_token on refresh responses (the original
    // stays valid), so we carry the existing one forward unless a new one is sent.
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? credentials.refreshToken,
      expiresAt: token.expires_in
        ? new Date(this.now().getTime() + token.expires_in * 1000)
        : null,
    };
  }
}
