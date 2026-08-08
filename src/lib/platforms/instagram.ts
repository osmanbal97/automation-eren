import type { ErrorLogStore } from "@/lib/error-log";
import { callWithRetry } from "@/lib/resilient-client";
import {
  PlatformAuthError,
  PlatformNotApprovedError,
  PlatformPublishError,
  type Platform,
  type PlatformAdapter,
  type PlatformCredentials,
  type PublishPayload,
  type PublishResult,
} from "./types";

/**
 * Instagram Reels are capped at 90 seconds by the Content Publishing API. We
 * reject longer videos before spending a request (and a publishing-quota slot)
 * on something the platform will refuse anyway.
 */
export const INSTAGRAM_REELS_MAX_DURATION_SECONDS = 90;

const DEFAULT_BASE_URL = "https://graph.facebook.com";
const DEFAULT_API_VERSION = "v21.0";
const DEFAULT_MAX_POLLS = 30;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

/**
 * Container lifecycle values documented for the `status_code` field. ASSUMPTION
 * to revisit against the live API: we treat anything that is not FINISHED /
 * ERROR / EXPIRED as "still working" and keep polling, the same defensive
 * approach `higgsfield.ts` takes with its status vocabulary.
 */
type ContainerStatusCode = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

interface CreateContainerResponse {
  id: string;
}

interface ContainerStatusResponse {
  id?: string;
  status_code?: string;
  /** Human-readable detail Meta returns alongside a failed container. */
  status?: string;
}

interface PublishContainerResponse {
  id: string;
}

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

/**
 * Graph API error codes that mean "the token itself is no good" rather than
 * "this particular request was wrong".
 * ASSUMPTION to revisit against the live API: 190 is the documented
 * OAuthException code; 102 is the session-invalidated code.
 */
const AUTH_ERROR_CODES = new Set([102, 190]);

/**
 * Codes that mean the token is fine but the app/account is not cleared for the
 * action — Meta app review still pending, or a scope such as
 * `instagram_content_publish` was never granted. The publish worker parks these
 * as awaiting_platform_approval instead of burning retries.
 * ASSUMPTION to revisit against the live API: 3 = unsupported/unapproved
 * method, 10 = permission denied, 200 = permissions error.
 */
const NOT_APPROVED_ERROR_CODES = new Set([3, 10, 200]);

const PERMISSION_MESSAGE_PATTERN =
  /permission|app review|not been approved|scope|instagram_content_publish|instagram_basic/i;

export interface InstagramAdapterOptions {
  baseUrl?: string;
  apiVersion?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  errorLogStore?: ErrorLogStore;
  /** Retry tuning, passed straight through to callWithRetry — mainly for fast, deterministic tests. */
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Bounded container polling, so a stuck upload fails loudly instead of hanging the worker. */
  maxPolls?: number;
  pollIntervalMs?: number;
}

/**
 * Publishes Reels through the Instagram Graph API's three-step container model:
 * create container -> poll until the upload finishes transcoding -> publish.
 *
 * Stays a pure API client (no database writes) so it is unit-testable against a
 * mocked fetch, exactly like the video providers.
 */
export class InstagramAdapter implements PlatformAdapter {
  readonly platform: Platform = "instagram";

  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly errorLogStore?: ErrorLogStore;
  private readonly maxAttempts?: number;
  private readonly baseDelayMs?: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random?: () => number;
  private readonly maxPolls: number;
  private readonly pollIntervalMs: number;

  constructor(options: InstagramAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.errorLogStore = options.errorLogStore;
    this.maxAttempts = options.maxAttempts;
    this.baseDelayMs = options.baseDelayMs;
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.random = options.random;
    this.maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async publish(payload: PublishPayload, credentials: PlatformCredentials): Promise<PublishResult> {
    this.assertPublishable(payload);
    const igUserId = this.requireIgUserId(credentials);

    const containerId = await this.createContainer(payload, credentials, igUserId);
    await this.waitForContainer(containerId, credentials);
    return { platformPostId: await this.publishContainer(containerId, credentials, igUserId) };
  }

  /** Client-side guards that must run before any network call is made. */
  private assertPublishable(payload: PublishPayload): void {
    const duration = payload.durationSeconds;
    if (duration !== undefined && duration > INSTAGRAM_REELS_MAX_DURATION_SECONDS) {
      // Status 0: rejected locally, so no HTTP request was ever issued.
      throw new PlatformPublishError(
        this.platform,
        "publish",
        0,
        `Instagram Reels are limited to ${INSTAGRAM_REELS_MAX_DURATION_SECONDS} seconds; this video is ${duration}s. Trim the video before scheduling it.`,
      );
    }
  }

  private requireIgUserId(credentials: PlatformCredentials): string {
    const igUserId = credentials.externalAccountId;
    if (!igUserId) {
      throw new PlatformAuthError(
        this.platform,
        "Instagram credentials are missing externalAccountId (the IG user id required by the Graph API). Reconnect the account.",
      );
    }
    return igUserId;
  }

  /** Reels captions carry hashtags inline — there is no separate hashtag field. */
  private buildCaption(payload: PublishPayload): string {
    const tags = payload.hashtags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
    return [payload.caption.trim(), ...tags].filter(Boolean).join(" ");
  }

  private endpoint(path: string): string {
    return `${this.baseUrl}/${this.apiVersion}${path}`;
  }

  /**
   * Issues one Graph API call through callWithRetry (429/5xx get exponential
   * backoff) and turns a non-OK response into the right typed platform error.
   */
  private async requestJson<T>(
    url: string,
    init: RequestInit,
    operation: string,
  ): Promise<T> {
    const response = await callWithRetry({
      provider: "instagram",
      operation,
      execute: () => this.fetchImpl(url, init),
      errorLogStore: this.errorLogStore,
      payloadSummary: `${init.method ?? "GET"} ${operation}`,
      maxAttempts: this.maxAttempts,
      baseDelayMs: this.baseDelayMs,
      sleep: this.sleep,
      random: this.random,
    });

    const body = await this.readJson(response);

    if (!response.ok) {
      throw this.toTypedError(response.status, body, operation);
    }

    return body as T;
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      // Meta occasionally returns an empty or HTML body on gateway errors.
      return undefined;
    }
  }

  private toTypedError(status: number, body: unknown, operation: string): Error {
    const graphError = (body as GraphErrorEnvelope | undefined)?.error;
    const message = graphError?.error_user_msg ?? graphError?.message;
    const code = graphError?.code;
    const detail = message ?? `HTTP ${status}`;

    if (
      (code !== undefined && NOT_APPROVED_ERROR_CODES.has(code)) ||
      (message !== undefined && PERMISSION_MESSAGE_PATTERN.test(message))
    ) {
      return new PlatformNotApprovedError(
        this.platform,
        `Instagram ${operation} was refused pending permissions/app review: ${detail}`,
      );
    }

    if ((code !== undefined && AUTH_ERROR_CODES.has(code)) || status === 401) {
      return new PlatformAuthError(
        this.platform,
        `Instagram rejected the access token during ${operation}: ${detail}`,
      );
    }

    return new PlatformPublishError(
      this.platform,
      operation,
      status,
      `Instagram ${operation} failed with HTTP ${status}: ${detail}`,
    );
  }

  /** Step 1: create the REELS media container Meta will pull the video into. */
  private async createContainer(
    payload: PublishPayload,
    credentials: PlatformCredentials,
    igUserId: string,
  ): Promise<string> {
    // Form-encoded body is the documented shape for Graph API write calls.
    const params = new URLSearchParams({
      media_type: "REELS",
      video_url: payload.videoUrl,
      caption: this.buildCaption(payload),
      access_token: credentials.accessToken,
    });

    const body = await this.requestJson<CreateContainerResponse>(
      this.endpoint(`/${igUserId}/media`),
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
      "createContainer",
    );

    if (!body?.id) {
      throw new PlatformPublishError(
        this.platform,
        "createContainer",
        200,
        "Instagram accepted the container request but returned no container id.",
      );
    }
    return body.id;
  }

  /** Step 2: poll status_code until the container finishes transcoding. */
  private async waitForContainer(
    containerId: string,
    credentials: PlatformCredentials,
  ): Promise<void> {
    const query = new URLSearchParams({
      fields: "status_code,status",
      access_token: credentials.accessToken,
    });
    const url = `${this.endpoint(`/${containerId}`)}?${query.toString()}`;

    for (let poll = 1; poll <= this.maxPolls; poll++) {
      const body = await this.requestJson<ContainerStatusResponse>(
        url,
        { method: "GET" },
        "getContainerStatus",
      );
      const statusCode = (body?.status_code ?? "").toUpperCase() as ContainerStatusCode;

      if (statusCode === "FINISHED" || statusCode === "PUBLISHED") {
        return;
      }
      if (statusCode === "ERROR" || statusCode === "EXPIRED") {
        throw new PlatformPublishError(
          this.platform,
          "getContainerStatus",
          200,
          `Instagram container ${containerId} ended in ${statusCode}${body?.status ? `: ${body.status}` : ""}.`,
        );
      }

      if (poll < this.maxPolls) {
        await this.sleep(this.pollIntervalMs);
      }
    }

    throw new PlatformPublishError(
      this.platform,
      "getContainerStatus",
      // 504: the request chain itself succeeded, Instagram just never finished in time.
      504,
      `Instagram container ${containerId} did not reach FINISHED within ${this.maxPolls} polls (~${(this.maxPolls * this.pollIntervalMs) / 1000}s).`,
    );
  }

  /** Step 3: publish the finished container and return the live media id. */
  private async publishContainer(
    containerId: string,
    credentials: PlatformCredentials,
    igUserId: string,
  ): Promise<string> {
    const params = new URLSearchParams({
      creation_id: containerId,
      access_token: credentials.accessToken,
    });

    const body = await this.requestJson<PublishContainerResponse>(
      this.endpoint(`/${igUserId}/media_publish`),
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
      "mediaPublish",
    );

    if (!body?.id) {
      throw new PlatformPublishError(
        this.platform,
        "mediaPublish",
        200,
        `Instagram published container ${containerId} but returned no media id.`,
      );
    }
    return body.id;
  }
}
