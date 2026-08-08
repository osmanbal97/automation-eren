import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { platformConnections } from "@/db/schema";

export type Platform = "tiktok" | "instagram" | "youtube";
export type ConnectionStatus = "disconnected" | "pending_review" | "active";

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
