import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Database } from "@/db/client";
import { publishJobs, scheduledPosts } from "@/db/schema";
import type { Platform, PlatformAdapter } from "@/lib/platforms/types";
import { publishScheduledPost, type PublishOutcome } from "./publish";
import type { Channel } from "./types";

/** After a scheduled post has this many recorded publish_jobs rows, the worker stops
 * retrying it and marks it permanently "failed" instead of leaving it eligible to be
 * claimed again on the next tick. */
export const MAX_PUBLISH_ATTEMPTS = 5;

export type WorkerAttemptOutcome = PublishOutcome | { outcome: "failed_max_attempts"; error: string };

/**
 * Atomically claims up to `limit` due scheduled_posts (status="scheduled" and
 * scheduled_at <= now) for this worker run: SELECT ... FOR UPDATE SKIP LOCKED inside a
 * transaction, immediately flipping the claimed rows to status="publishing" before the
 * transaction commits. Ordered oldest-due-first so a backlog drains fairly.
 *
 * Against a real Postgres this is what makes two overlapping cron invocations safe: a
 * second run's own SKIP LOCKED select simply excludes any row still locked by an
 * in-flight first transaction (it never blocks waiting for it), and once the first
 * transaction commits, the row's status is no longer "scheduled" so the second run's
 * WHERE clause excludes it anyway. Either mechanism alone would be enough; having both
 * means no in-flight or already-claimed row can ever be claimed twice.
 *
 * Note for test authors: @electric-sql/pglite (the WASM Postgres used in this repo's
 * tests) serializes every db.transaction() call onto a single logical connection, so a
 * pglite-backed test can never make two claimTx calls genuinely overlap -- one will
 * always fully commit before the other's first statement runs. Such a test can still
 * prove this function's compare-and-set correctness (a post claimed once is no longer
 * "scheduled" for a second call to find), just not real lock contention.
 */
export async function claimDuePosts(db: Database, now: Date, limit = 10) {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.status, "scheduled"), lte(scheduledPosts.scheduledAt, now)))
      .orderBy(asc(scheduledPosts.scheduledAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    if (due.length === 0) {
      return [];
    }

    const ids = due.map((post) => post.id);
    await tx
      .update(scheduledPosts)
      .set({ status: "publishing", updatedAt: new Date() })
      .where(inArray(scheduledPosts.id, ids));

    return due;
  });
}

async function countPublishAttempts(db: Database, scheduledPostId: string) {
  const jobs = await db.select({ id: publishJobs.id }).from(publishJobs).where(eq(publishJobs.scheduledPostId, scheduledPostId));
  return jobs.length;
}

/**
 * Runs one publish-worker tick (US-024): claims due posts via claimDuePosts, then
 * attempts each sequentially through publishScheduledPost (US-020). Sequential on
 * purpose, same rationale as the generation-job poller -- these calls hit paid
 * third-party publish APIs and the batch per tick is small.
 *
 * This is the piece US-020 deliberately left undone: when publishScheduledPost reports
 * "retry_scheduled", this function counts that post's accumulated publish_jobs rows and,
 * once MAX_PUBLISH_ATTEMPTS is reached, marks the post permanently "failed" instead of
 * leaving it eligible for another claim next tick.
 */
export async function runPublishWorkerTick(
  db: Database,
  adapters: Partial<Record<Platform, PlatformAdapter>>,
  channel: Channel,
  options: { now?: Date; limit?: number; maxAttempts?: number } = {},
) {
  const now = options.now ?? new Date();
  const maxAttempts = options.maxAttempts ?? MAX_PUBLISH_ATTEMPTS;
  const claimed = await claimDuePosts(db, now, options.limit ?? 10);

  const summary = { claimed: claimed.length, published: 0, awaitingApproval: 0, retryScheduled: 0, failedMaxAttempts: 0 };
  const results: { scheduledPostId: string; outcome: WorkerAttemptOutcome }[] = [];

  for (const post of claimed) {
    // publishScheduledPost re-sets status to "publishing" itself right before calling the
    // adapter; claimDuePosts already did so above, so this is a harmless redundant write
    // that keeps publishScheduledPost's own contract self-contained and testable in
    // isolation from the worker that calls it.
    let outcome: WorkerAttemptOutcome = await publishScheduledPost(db, post.id, adapters, channel);

    if (outcome.outcome === "retry_scheduled") {
      const attempts = await countPublishAttempts(db, post.id);
      if (attempts >= maxAttempts) {
        await db.update(scheduledPosts).set({ status: "failed", updatedAt: new Date() }).where(eq(scheduledPosts.id, post.id));
        outcome = { outcome: "failed_max_attempts", error: outcome.error };
      }
    }

    switch (outcome.outcome) {
      case "published":
        summary.published += 1;
        break;
      case "awaiting_platform_approval":
        summary.awaitingApproval += 1;
        break;
      case "retry_scheduled":
        summary.retryScheduled += 1;
        break;
      case "failed_max_attempts":
        summary.failedMaxAttempts += 1;
        break;
    }
    results.push({ scheduledPostId: post.id, outcome });
  }

  return { ...summary, results };
}
