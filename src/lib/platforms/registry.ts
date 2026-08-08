import type { Database } from "@/db/client";
import { createDrizzleQuotaStore } from "@/lib/quota";
import type { ErrorLogStore } from "@/lib/error-log";
import { InstagramAdapter } from "./instagram";
import { TikTokAdapter } from "./tiktok";
import type { Platform, PlatformAdapter } from "./types";
import { YouTubeAdapter } from "./youtube";

export interface PlatformRegistryOptions {
  errorLogStore?: ErrorLogStore;
}

/**
 * Builds the full platform -> adapter map for the publish worker (US-024). Every
 * adapter constructor falls back to its own env vars for OAuth app credentials
 * (TIKTOK_CLIENT_KEY/SECRET, GOOGLE_CLIENT_ID/SECRET) when not passed explicitly, so
 * this registry needs no config of its own beyond a db handle for YouTube's quota
 * counters. Registering an adapter here does not require that platform's OAuth connect
 * flow (US-021/022/023) to exist yet -- publishScheduledPost gates on
 * platform_connections.status before ever reaching the adapter, so an adapter with no
 * connected account simply never gets called.
 */
export function buildPlatformAdapters(db: Database, options: PlatformRegistryOptions = {}): Partial<Record<Platform, PlatformAdapter>> {
  return {
    tiktok: new TikTokAdapter({ errorLogStore: options.errorLogStore }),
    instagram: new InstagramAdapter({ errorLogStore: options.errorLogStore }),
    youtube: new YouTubeAdapter({ quotaStore: createDrizzleQuotaStore(db), errorLogStore: options.errorLogStore }),
  };
}
