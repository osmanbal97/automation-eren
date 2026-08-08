import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { publishJobs, scheduledPosts } from "@/db/schema";
import { PlatformNotApprovedError, type Platform, type PlatformAdapter } from "@/lib/platforms/types";
import { ActionNotFoundError } from "./errors";
import { publishScheduledPost } from "./publish";
import {
  seedGenerationJob,
  seedIdea,
  seedNiche,
  seedPlatformConnection,
  seedProvider,
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

/** Seeds a full chain -- niche, idea, generation job, video, scheduled post -- so
 * publishScheduledPost has a real row to operate on. */
async function seedReadyScheduledPost(db: Database, connectionStatus: "disconnected" | "pending_review" | "active") {
  const niche = await seedNiche(db);
  const provider = await seedProvider(db);
  const idea = await seedIdea(db, niche.id);
  const job = await seedGenerationJob(db, idea.id, provider.id);
  const video = await seedVideo(db, niche.id, idea.id, job.id, { status: "ready_to_schedule" });
  await seedPlatformConnection(db, niche.id, { platform: "tiktok", status: connectionStatus });
  const post = await seedScheduledPost(db, video.id, niche.id, { platform: "tiktok" });
  return { niche, video, post };
}

describe("publishScheduledPost", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("throws ActionNotFoundError for an unknown scheduled post", async () => {
    await expect(publishScheduledPost(db, crypto.randomUUID(), {}, "web")).rejects.toThrow(ActionNotFoundError);
  });

  it("parks as awaiting_platform_approval and never calls the adapter when disconnected", async () => {
    const { post } = await seedReadyScheduledPost(db, "disconnected");
    const adapter = fakeAdapter("tiktok");

    const result = await publishScheduledPost(db, post.id, { tiktok: adapter }, "web");

    expect(result).toEqual({ outcome: "awaiting_platform_approval" });
    expect(adapter.publish).not.toHaveBeenCalled();
    const [updated] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, post.id));
    expect(updated.status).toBe("awaiting_platform_approval");
  });

  it("parks as awaiting_platform_approval and never calls the adapter when pending_review", async () => {
    const { post } = await seedReadyScheduledPost(db, "pending_review");
    const adapter = fakeAdapter("tiktok");

    const result = await publishScheduledPost(db, post.id, { tiktok: adapter }, "web");

    expect(result).toEqual({ outcome: "awaiting_platform_approval" });
    expect(adapter.publish).not.toHaveBeenCalled();
  });

  it("proceeds to the adapter and marks published on success when active", async () => {
    const { post } = await seedReadyScheduledPost(db, "active");
    const adapter = fakeAdapter("tiktok");

    const result = await publishScheduledPost(db, post.id, { tiktok: adapter }, "web");

    expect(result).toEqual({ outcome: "published", platformPostId: "ext-post-1" });
    expect(adapter.publish).toHaveBeenCalledTimes(1);
    const [updated] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, post.id));
    expect(updated.status).toBe("published");
    const [job] = await db.select().from(publishJobs).where(eq(publishJobs.scheduledPostId, post.id));
    expect(job.status).toBe("success");
    expect(job.platformPostId).toBe("ext-post-1");
  });

  it("leaves the post scheduled for a future retry on a generic adapter failure", async () => {
    const { post } = await seedReadyScheduledPost(db, "active");
    const adapter = fakeAdapter("tiktok", { publish: vi.fn().mockRejectedValue(new Error("HTTP 500")) });

    const result = await publishScheduledPost(db, post.id, { tiktok: adapter }, "web");

    expect(result).toEqual({ outcome: "retry_scheduled", error: "HTTP 500" });
    const [updated] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, post.id));
    expect(updated.status).toBe("scheduled");
    const [job] = await db.select().from(publishJobs).where(eq(publishJobs.scheduledPostId, post.id));
    expect(job.status).toBe("failed");
    expect(job.lastError).toBe("HTTP 500");
  });

  it("parks as awaiting_platform_approval (not a retry) when the adapter reports not-yet-approved", async () => {
    const { post } = await seedReadyScheduledPost(db, "active");
    const adapter = fakeAdapter("tiktok", {
      publish: vi.fn().mockRejectedValue(new PlatformNotApprovedError("tiktok", "audit not passed")),
    });

    const result = await publishScheduledPost(db, post.id, { tiktok: adapter }, "web");

    expect(result).toEqual({ outcome: "awaiting_platform_approval" });
    const [updated] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, post.id));
    expect(updated.status).toBe("awaiting_platform_approval");
    const [job] = await db.select().from(publishJobs).where(eq(publishJobs.scheduledPostId, post.id));
    expect(job.status).toBe("failed");
  });

  it("throws when no adapter is registered for the post's platform", async () => {
    const { post } = await seedReadyScheduledPost(db, "active");

    await expect(publishScheduledPost(db, post.id, {}, "web")).rejects.toThrow(
      'No adapter registered for platform "tiktok"',
    );
  });
});
