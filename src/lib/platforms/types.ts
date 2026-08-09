import type { platformEnum } from "@/db/schema";

/**
 * Shared contract every publishing platform adapter (TikTok US-021, Instagram
 * US-022, YouTube US-023) implements, so the publish worker (US-024) never needs
 * to know which platform is behind a scheduled post -- mirroring how
 * VideoProvider abstracts the generation vendors.
 */

export type Platform = (typeof platformEnum.enumValues)[number];

/** The video being published, resolved from our own Blob storage (US-003). */
export interface PublishPayload {
  /** Publicly-fetchable URL the platform will pull the file from. */
  videoUrl: string;
  caption: string;
  hashtags: string[];
  durationSeconds?: number;
}

export interface PublishResult {
  /** The platform's own id for the created post, stored on publish_jobs.platform_post_id. */
  platformPostId: string;
}

/** OAuth material for one niche+platform, decrypted from platform_connections. */
export interface PlatformCredentials {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  externalAccountId?: string | null;
}

/**
 * Returned when an adapter refreshes an expired access token, so the caller can
 * persist the new values back onto platform_connections. Adapters never write to
 * the database themselves -- they stay pure API clients, which is what makes them
 * unit-testable against a mocked HTTP layer.
 */
export interface RefreshedCredentials {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  /** Publishes the video, returning the platform's post id. */
  publish(payload: PublishPayload, credentials: PlatformCredentials): Promise<PublishResult>;
  /**
   * Exchanges a refresh token for a fresh access token. Optional: not every
   * platform expires tokens on a cadence that requires it.
   */
  refreshCredentials?(credentials: PlatformCredentials): Promise<RefreshedCredentials>;
}

/** A platform rejected the request for a reason retrying will not fix. */
export class PlatformPublishError extends Error {
  constructor(
    public readonly platform: Platform,
    public readonly operation: string,
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? `${platform} ${operation} failed with HTTP ${status}`);
    this.name = "PlatformPublishError";
  }
}

/**
 * The account exists and the token is valid, but the platform has not cleared
 * the app/account for public posting yet (TikTok audit, Meta app review, Google
 * OAuth verification). Distinct from a generic failure so the publish worker can
 * park the post as awaiting_platform_approval (US-020) rather than burning retries.
 */
export class PlatformNotApprovedError extends Error {
  constructor(
    public readonly platform: Platform,
    message: string,
  ) {
    super(message);
    this.name = "PlatformNotApprovedError";
  }
}

/** The stored credentials are expired/revoked and could not be refreshed. */
export class PlatformAuthError extends Error {
  constructor(
    public readonly platform: Platform,
    message: string,
  ) {
    super(message);
    this.name = "PlatformAuthError";
  }
}
