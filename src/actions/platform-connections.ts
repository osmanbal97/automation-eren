import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { platformConnections } from "@/db/schema";
import { encryptToken } from "@/lib/crypto";

export type Platform = "tiktok" | "instagram" | "youtube";
export type ConnectionStatus = "disconnected" | "pending_review" | "active";

export interface ConnectionTokens {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  externalAccountId?: string | null;
}

/**
 * Platform connections aren't triggered from Telegram, so like niches.ts there's no
 * channel column to track here. Real OAuth wiring (token storage, refresh) lands with
 * the platform-specific adapters later; for now this is a manual status toggle the
 * operator flips once they know a platform's audit/review has actually passed.
 */
export async function setConnectionStatus(
  db: Database,
  nicheId: string,
  platform: Platform,
  status: ConnectionStatus,
) {
  const [connection] = await db
    .insert(platformConnections)
    .values({ nicheId, platform, status })
    .onConflictDoUpdate({
      target: [platformConnections.nicheId, platformConnections.platform],
      set: { status, updatedAt: new Date() },
    })
    .returning();
  return connection;
}

export async function getConnectionsForNiche(db: Database, nicheId: string) {
  return db.select().from(platformConnections).where(eq(platformConnections.nicheId, nicheId));
}

/**
 * Persists a freshly-exchanged OAuth token set for a niche+platform (US-021/022/023's
 * callback routes call this once their authorization-code exchange succeeds), encrypting
 * both tokens at rest via crypto.ts and marking the connection "active". A successful
 * exchange means the account is genuinely connected; a platform-specific "not audited
 * yet" condition (e.g. TikTok pre-review) is a separate, dynamic concern handled at
 * publish time via PlatformNotApprovedError, not by withholding "active" here.
 */
export async function saveConnectionTokens(
  db: Database,
  nicheId: string,
  platform: Platform,
  tokens: ConnectionTokens,
) {
  const accessTokenEncrypted = encryptToken(tokens.accessToken);
  const refreshTokenEncrypted = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null;
  const values = {
    nicheId,
    platform,
    status: "active" as const,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    tokenExpiresAt: tokens.expiresAt ?? null,
    externalAccountId: tokens.externalAccountId ?? null,
  };

  const [connection] = await db
    .insert(platformConnections)
    .values(values)
    .onConflictDoUpdate({
      target: [platformConnections.nicheId, platformConnections.platform],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  return connection;
}
