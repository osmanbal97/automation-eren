import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import type { Database } from "@/db/client";
import { niches, platformEnum, scheduledPosts, videos } from "@/db/schema";
import { ActionNotFoundError, InvalidActionStateError } from "./errors";
import type { TargetPostsPerDay } from "./niches";
import type { Channel } from "./types";

export type Platform = (typeof platformEnum.enumValues)[number];

/** Thrown when scheduling a video onto a platform would push that platform's count of
 * non-failed scheduled_posts for the day past the niche's configured daily cap. */
export class SchedulingCapExceededError extends Error {
  constructor(platform: Platform, dateKey: string, cap: number) {
    super(`Daily cap of ${cap} reached for ${platform} on ${dateKey}`);
    this.name = "SchedulingCapExceededError";
  }
}

function dayRangeUtc(at: Date): { start: Date; end: Date; dateKey: string } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, dateKey: start.toISOString().slice(0, 10) };
}

/** Counts non-failed scheduled_posts already on the books for one niche+platform on the
 * UTC calendar day containing `at` -- a failed attempt didn't consume the day's slot, so
 * it's excluded from the count. */
async function countScheduledForDay(db: Database, nicheId: string, platform: Platform, at: Date) {
  const { start, end } = dayRangeUtc(at);
  const rows = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.nicheId, nicheId),
        eq(scheduledPosts.platform, platform),
        gte(scheduledPosts.scheduledAt, start),
        lt(scheduledPosts.scheduledAt, end),
        ne(scheduledPosts.status, "failed"),
      ),
    );
  return rows.length;
}

/**
 * Schedules a ready_to_schedule video onto one or more platforms at a given time
 * (US-019), creating one scheduled_posts row per platform. Every requested platform is
 * checked against the niche's per-platform daily cap (niches.targetPostsPerDay) before
 * any row is inserted, so a batch either fully succeeds or fails with a clear error
 * naming the platform that's full -- no partial scheduling of the batch.
 */
export async function schedulePost(
  db: Database,
  videoId: string,
  platforms: Platform[],
  scheduledAt: Date,
  channel: Channel,
) {
  if (platforms.length === 0) {
    throw new Error("Select at least one platform to schedule");
  }

  const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) {
    throw new ActionNotFoundError("Video", videoId);
  }
  if (video.status !== "ready_to_schedule") {
    throw new InvalidActionStateError("Video", videoId, ["ready_to_schedule"], video.status);
  }

  const [niche] = await db.select().from(niches).where(eq(niches.id, video.nicheId));
  if (!niche) {
    throw new ActionNotFoundError("Niche", video.nicheId);
  }
  const caps = niche.targetPostsPerDay as Partial<TargetPostsPerDay>;
  const { dateKey } = dayRangeUtc(scheduledAt);

  for (const platform of platforms) {
    const cap = caps[platform] ?? 0;
    const used = await countScheduledForDay(db, video.nicheId, platform, scheduledAt);
    if (used >= cap) {
      throw new SchedulingCapExceededError(platform, dateKey, cap);
    }
  }

  return db
    .insert(scheduledPosts)
    .values(
      platforms.map((platform) => ({
        videoId,
        nicheId: video.nicheId,
        platform,
        scheduledAt,
        createdVia: channel,
      })),
    )
    .returning();
}

/** Every scheduled_posts row for one video, ordered earliest-scheduled first -- used by
 * the scheduling UI to show which platforms/times a ready_to_schedule video already has. */
export async function listScheduledPostsForVideo(db: Database, videoId: string) {
  return db
    .select()
    .from(scheduledPosts)
    .where(eq(scheduledPosts.videoId, videoId))
    .orderBy(scheduledPosts.scheduledAt);
}

const UPCOMING_STATUSES = ["scheduled", "awaiting_platform_approval", "publishing"] as const;

/** Everything still due to go out, soonest first -- the Overview page's forward-looking
 * "what's about to publish" glance, distinct from History's all-time log. Excludes
 * anything already `published` or `failed` and anything whose scheduled time has already
 * passed (a stuck `scheduled` row past its time belongs in History/monitoring, not here). */
export async function listUpcomingScheduledPosts(db: Database, limit = 8) {
  return db
    .select({ post: scheduledPosts, video: videos, nicheName: niches.name })
    .from(scheduledPosts)
    .innerJoin(videos, eq(scheduledPosts.videoId, videos.id))
    .innerJoin(niches, eq(scheduledPosts.nicheId, niches.id))
    .where(and(gte(scheduledPosts.scheduledAt, new Date()), inArray(scheduledPosts.status, UPCOMING_STATUSES)))
    .orderBy(asc(scheduledPosts.scheduledAt))
    .limit(limit);
}
