import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { scheduledPosts } from "@/db/schema";
import type { Platform, PlatformAdapter } from "@/lib/platforms/types";
import { claimDuePosts, runPublishWorkerTick } from "./publish-worker";
import {
  seedGenerationJob,
  seedIdea,
  seedNiche,
  seedPlatformConnection,
  seedProvider,
  seedPublishJob,
  seedScheduledPost,
  seedVideo,
} from "./test-helpers";

function fakeAdapter(platform: Platform, overrides: Partial<PlatformAdapter> = {}): PlatformAdapter {
  return {
    platform,
    publish: vi.fn().mockResolvedValue({ platformPostId: "ext-post-1" }),
    ...overrides,
  };
}

/** Seeds a full chain -- niche, idea, generation job, video, active connection, due
 * scheduled post -- so the worker has a real claimable row to operate on. Each call
 * seeds its own niche and provider, so pass a distinct `label` when seeding more than
 * one post in the same test to avoid colliding on video_providers' unique name. */
async function seedDuePost(db: Database, scheduledAt = new Date(Date.now() - 60_000), label = "a") {
  const niche = await seedNiche(db, { name: `Trippy POV ${label}` });
  const provider = await seedProvider(db, { name: `Higgsfield ${label}`, adapterKey: `higgsfield-${label}` });
  const idea = await seedIdea(db, niche.id);
  const job = await seedGenerationJob(db, idea.id, provider.id);
  const video = await seedVideo(db, niche.id, idea.id, job.id, { status: "ready_to_schedule" });
  await seedPlatformConnection(db, niche.id, { platform: "tiktok", status: "active" });
  const post = await seedScheduledPost(db, video.id, niche.id, { platform: "tiktok", scheduledAt });
  return { niche, video, post };
}

describe("claimDuePosts", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("claims a due scheduled post and flips it to publishing", async () => {
    const { post } = await seedDuePost(db);

    const claimed = await claimDuePosts(db, new Date());

    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(post.id);
    const [updated] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, post.id));
    expect(updated.status).toBe("publishing");
  });

  it("does not claim a post scheduled in the future", async () => {
    await seedDuePost(db, new Date(Date.now() + 60 * 60 * 1000));

    const claimed = await claimDuePosts(db, new Date());

    expect(claimed).toHaveLength(0);
  });

  it("does not claim a post that isn't in status=scheduled", async () => {
    const { post } = await seedDuePost(db);
    await db.update(scheduledPosts).set({ status: "published" }).where(eq(scheduledPosts.id, post.id));

    const claimed = await claimDuePosts(db, new Date());

    expect(claimed).toHaveLength(0);
  });

  it("does not re-claim a post it already claimed (compare-and-set guard) -- see file-level note on pglite's inability to test true concurrent locking", async () => {
    const { post } = await seedDuePost(db);

    const first = await claimDuePosts(db, new Date());
    const second = await claimDuePosts(db, new Date());

    // This proves the status guard alone -- once claimed, a post is no longer
    // status="scheduled" so a second call (however overlapping in a real deployment)
    // cannot pick it up too. @electric-sql/pglite serializes every db.transaction() call
    // onto one logical connection, so this test cannot exercise genuine concurrent
    // FOR UPDATE SKIP LOCKED contention -- only that the second, later call finds nothing
    // left to claim. See claimDuePosts's doc comment for the full explanation.
    expect(first.map((p) => p.id)).toEqual([post.id]);
    expect(second).toHaveLength(0);
  });

  it("respects the limit and orders oldest-due-first", async () => {
    const older = await seedDuePost(db, new Date(Date.now() - 2 * 60 * 60 * 1000), "older");
    const newer = await seedDuePost(db, new Date(Date.now() - 60 * 1000), "newer");

    const claimed = await claimDuePosts(db, new Date(), 1);

    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(older.post.id);
    // the newer due post is untouched, still eligible for the next tick
    const [untouched] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, newer.post.id));
    expect(untouched.status).toBe("scheduled");
  });
});

describe("runPublishWorkerTick", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("claims and publishes a due post through the given adapter", async () => {
    const { post } = await seedDuePost(db);
    const adapter = fakeAdapter("tiktok");

    const summary = await runPublishWorkerTick(db, { tiktok: adapter }, "web");

    expect(summary).toMatchObject({ claimed: 1, published: 1, awaitingApproval: 0, retryScheduled: 0, failedMaxAttempts: 0 });
    expect(adapter.publish).toHaveBeenCalledTimes(1);
    const [updated] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, post.id));
    expect(updated.status).toBe("published");
  });

  it("returns retry_scheduled and leaves the post scheduled below the attempt cap", async () => {
    const { post } = await seedDuePost(db);
    const adapter = fakeAdapter("tiktok", { publish: vi.fn().mockRejectedValue(new Error("HTTP 500")) });

    const summary = await runPublishWorkerTick(db, { tiktok: adapter }, "web", { maxAttempts: 3 });

    expect(summary.retryScheduled).toBe(1);
    expect(summary.failedMaxAttempts).toBe(0);
    const [updated] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, post.id));
    expect(updated.status).toBe("scheduled");
  });

  it("marks the post permanently failed once the attempt cap is reached", async () => {
    const { post } = await seedDuePost(db);
    // two prior failed attempts already on record; this tick's failure is the third
    await seedPublishJob(db, post.id, { status: "failed", lastError: "HTTP 500" });
    await seedPublishJob(db, post.id, { status: "failed", lastError: "HTTP 500" });
    const adapter = fakeAdapter("tiktok", { publish: vi.fn().mockRejectedValue(new Error("HTTP 500")) });

    const summary = await runPublishWorkerTick(db, { tiktok: adapter }, "web", { maxAttempts: 3 });

    expect(summary.failedMaxAttempts).toBe(1);
    expect(summary.retryScheduled).toBe(0);
    expect(summary.results[0].outcome).toEqual({ outcome: "failed_max_attempts", error: "HTTP 500" });
    const [updated] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, post.id));
    expect(updated.status).toBe("failed");
  });

  it("does nothing when there are no due posts", async () => {
    const summary = await runPublishWorkerTick(db, {}, "web");

    expect(summary).toMatchObject({ claimed: 0, published: 0, awaitingApproval: 0, retryScheduled: 0, failedMaxAttempts: 0 });
    expect(summary.results).toEqual([]);
  });
});
