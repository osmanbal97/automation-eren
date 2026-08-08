import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { platformConnections, publishJobs, scheduledPosts, videos } from "@/db/schema";
import { decryptTokenOrNull } from "@/lib/crypto";
import { PlatformNotApprovedError, type Platform, type PlatformAdapter, type PlatformCredentials } from "@/lib/platforms/types";
import { ActionNotFoundError } from "./errors";
import type { Channel } from "./types";

export type PublishOutcome =
  | { outcome: "awaiting_platform_approval" }
  | { outcome: "published"; platformPostId: string }
  | { outcome: "retry_scheduled"; error: string };

async function parkAwaitingApproval(db: Database, scheduledPostId: string) {
  await db
    .update(scheduledPosts)
    .set({ status: "awaiting_platform_approval", updatedAt: new Date() })
    .where(eq(scheduledPosts.id, scheduledPostId));
}

/**
 * Attempts one publish of a single scheduled_posts row (US-020's gating, plus the
 * single-attempt half of US-024's publish worker). Checks platform_connections.status
 * BEFORE ever calling a platform adapter: if the niche's connection for this post's
 * platform isn't "active", the post is parked as awaiting_platform_approval and no API
 * call is made at all, burning zero quota/retries on a platform that hasn't cleared
 * review yet. Only once the connection is active does this proceed to the platform
 * adapter (US-021/022/023).
 *
 * Deliberately out of scope here (that's US-024's job, not this function's): selecting
 * which due posts to attempt, concurrency-safe locking across overlapping cron runs, and
 * deciding when enough retry attempts have been made to mark a post permanently "failed"
 * -- a generic adapter failure here instead leaves the post's status back at "scheduled"
 * (eligible for a future retry) and records one failed publish_jobs row, so the worker
 * can count attempts across those rows itself.
 */
export async function publishScheduledPost(
  db: Database,
  scheduledPostId: string,
  adapters: Partial<Record<Platform, PlatformAdapter>>,
  channel: Channel,
): Promise<PublishOutcome> {
  const [post] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, scheduledPostId));
  if (!post) {
    throw new ActionNotFoundError("ScheduledPost", scheduledPostId);
  }

  const [connection] = await db
    .select()
    .from(platformConnections)
    .where(and(eq(platformConnections.nicheId, post.nicheId), eq(platformConnections.platform, post.platform)));

  if (!connection || connection.status !== "active") {
    await parkAwaitingApproval(db, scheduledPostId);
    return { outcome: "awaiting_platform_approval" };
  }

  const [video] = await db.select().from(videos).where(eq(videos.id, post.videoId));
  if (!video) {
    throw new ActionNotFoundError("Video", post.videoId);
  }

  const adapter = adapters[post.platform];
  if (!adapter) {
    throw new Error(`No adapter registered for platform "${post.platform}"`);
  }

  await db
    .update(scheduledPosts)
    .set({ status: "publishing", updatedAt: new Date() })
    .where(eq(scheduledPosts.id, scheduledPostId));

  const credentials: PlatformCredentials = {
    accessToken: decryptTokenOrNull(connection.accessTokenEncrypted) ?? "",
    refreshToken: decryptTokenOrNull(connection.refreshTokenEncrypted),
    expiresAt: connection.tokenExpiresAt,
    externalAccountId: connection.externalAccountId,
  };

  try {
    const result = await adapter.publish(
      {
        videoUrl: video.blobUrl,
        caption: video.caption,
        hashtags: (video.hashtags as string[] | null) ?? [],
        durationSeconds: video.durationSeconds ? Number(video.durationSeconds) : undefined,
      },
      credentials,
    );
    await db
      .insert(publishJobs)
      .values({
        scheduledPostId,
        status: "success",
        platformPostId: result.platformPostId,
        attemptCount: 1,
        updatedVia: channel,
      });
    await db
      .update(scheduledPosts)
      .set({ status: "published", updatedAt: new Date() })
      .where(eq(scheduledPosts.id, scheduledPostId));
    return { outcome: "published", platformPostId: result.platformPostId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .insert(publishJobs)
      .values({ scheduledPostId, status: "failed", lastError: message, attemptCount: 1, updatedVia: channel });

    if (error instanceof PlatformNotApprovedError) {
      // Not a transient failure -- the account genuinely hasn't cleared review yet, so
      // park it exactly like the pre-flight connection-status gate above instead of
      // leaving it "scheduled" for a retry that will just fail the same way again.
      await parkAwaitingApproval(db, scheduledPostId);
      return { outcome: "awaiting_platform_approval" };
    }

    await db
      .update(scheduledPosts)
      .set({ status: "scheduled", updatedAt: new Date() })
      .where(eq(scheduledPosts.id, scheduledPostId));
    return { outcome: "retry_scheduled", error: message };
  }
}
