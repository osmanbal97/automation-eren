import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { platformApps } from "@/db/schema";
import { decryptToken, encryptToken } from "@/lib/crypto";

export type Platform = "tiktok" | "instagram" | "youtube";

export interface PlatformAppCredentials {
  clientId: string;
  clientSecret: string;
}

/** Env var fallback per platform -- matches what tiktok-oauth.ts/instagram-oauth.ts/
 * youtube-oauth.ts (and the adapters) already read directly, so behavior is unchanged
 * for an operator who hasn't configured anything through the Socials UI yet. */
const ENV_FALLBACK: Record<Platform, { clientId: string; clientSecret: string }> = {
  tiktok: { clientId: "TIKTOK_CLIENT_KEY", clientSecret: "TIKTOK_CLIENT_SECRET" },
  instagram: { clientId: "META_APP_ID", clientSecret: "META_APP_SECRET" },
  youtube: { clientId: "GOOGLE_CLIENT_ID", clientSecret: "GOOGLE_CLIENT_SECRET" },
};

/** Encrypts and upserts one platform's app-level OAuth client id/secret (US-021/022/023's
 * "connect account" flow needs these before it can redirect anywhere). Set through the
 * Socials settings page -- this is the "ask the api keys" half of that flow. */
export async function savePlatformAppCredentials(
  db: Database,
  platform: Platform,
  clientId: string,
  clientSecret: string,
) {
  const values = {
    platform,
    clientIdEncrypted: encryptToken(clientId),
    clientSecretEncrypted: encryptToken(clientSecret),
  };

  const [row] = await db
    .insert(platformApps)
    .values(values)
    .onConflictDoUpdate({
      target: platformApps.platform,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  return row;
}

/**
 * Resolves the credentials the OAuth authorize/callback routes should use for `platform`:
 * a DB-configured row (via the Socials page) takes priority, falling back to the matching
 * process.env pair when nothing has been configured yet. Returns null -- never throws --
 * when neither source has a value, so callers can degrade to a "not configured" redirect
 * instead of a raw 500.
 */
export async function getPlatformAppCredentials(
  db: Database,
  platform: Platform,
): Promise<PlatformAppCredentials | null> {
  const [row] = await db.select().from(platformApps).where(eq(platformApps.platform, platform));
  if (row) {
    return {
      clientId: decryptToken(row.clientIdEncrypted),
      clientSecret: decryptToken(row.clientSecretEncrypted),
    };
  }

  const fallback = ENV_FALLBACK[platform];
  const clientId = process.env[fallback.clientId];
  const clientSecret = process.env[fallback.clientSecret];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export interface PlatformAppStatus {
  platform: Platform;
  configured: boolean;
  /** Last 4 characters of the configured client id, for display -- never the secret. */
  clientIdPreview: string | null;
  source: "database" | "env" | "none";
}

/** Per-platform configuration summary for the Socials page: whether a key is set and
 * where it came from, with only a masked preview of the client id -- the secret itself
 * is never returned to a caller that might render it. */
export async function listPlatformAppStatuses(db: Database): Promise<PlatformAppStatus[]> {
  const platforms: Platform[] = ["tiktok", "instagram", "youtube"];
  const rows = await db.select().from(platformApps);
  const rowByPlatform = new Map(rows.map((row) => [row.platform, row]));

  return platforms.map((platform) => {
    const row = rowByPlatform.get(platform);
    if (row) {
      const clientId = decryptToken(row.clientIdEncrypted);
      return {
        platform,
        configured: true,
        clientIdPreview: clientId.slice(-4),
        source: "database",
      };
    }

    const fallback = ENV_FALLBACK[platform];
    const envClientId = process.env[fallback.clientId];
    const envClientSecret = process.env[fallback.clientSecret];
    if (envClientId && envClientSecret) {
      return { platform, configured: true, clientIdPreview: envClientId.slice(-4), source: "env" };
    }

    return { platform, configured: false, clientIdPreview: null, source: "none" };
  });
}
