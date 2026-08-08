import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { ActionNotFoundError, InvalidActionStateError } from "./errors";
import { retryPublish, schedulePost } from "./scheduling";
import {
  seedGenerationJob,
  seedIdea,
  seedNiche,
  seedProvider,
  seedPublishJob,
  seedScheduledPost,
  seedVideo,
} from "./test-helpers";

describe("scheduling actions", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  async function seedReadyVideo() {
    const niche = await seedNiche(db);
    const provider = await seedProvider(db);
    const idea = await seedIdea(db, niche.id, { providerId: provider.id });
    const job = await seedGenerationJob(db, idea.id, provider.id, { status: "complete" });
    const video = await seedVideo(db, niche.id, idea.id, job.id, { status: "ready_to_schedule" });
    return { niche, video };
  }

  describe("schedulePost", () => {
    it("creates a scheduled_posts row and records the triggering channel", async () => {
      const { niche, video } = await seedReadyVideo();
      const scheduledAt = new Date("2026-08-09T12:00:00Z");

      const scheduled = await schedulePost(
        db,
        { videoId: video.id, nicheId: niche.id, platform: "tiktok", scheduledAt },
        "web",
      );

      expect(scheduled.status).toBe("scheduled");
      expect(scheduled.platform).toBe("tiktok");
      expect(scheduled.createdVia).toBe("web");
      expect(scheduled.scheduledAt.toISOString()).toBe(scheduledAt.toISOString());
    });

    it("refuses to schedule a video that isn't ready_to_schedule", async () => {
      const niche = await seedNiche(db);
      const provider = await seedProvider(db);
      const idea = await seedIdea(db, niche.id, { providerId: provider.id });
      const job = await seedGenerationJob(db, idea.id, provider.id, { status: "complete" });
      const video = await seedVideo(db, niche.id, idea.id, job.id, { status: "pending_review" });

      await expect(
        schedulePost(
          db,
          { videoId: video.id, nicheId: niche.id, platform: "tiktok", scheduledAt: new Date() },
          "web",
        ),
      ).rejects.toThrow(InvalidActionStateError);
    });

    it("throws ActionNotFoundError for an unknown video id", async () => {
      const niche = await seedNiche(db);

      await expect(
        schedulePost(
          db,
          {
            videoId: "00000000-0000-0000-0000-000000000000",
            nicheId: niche.id,
            platform: "instagram",
            scheduledAt: new Date(),
          },
          "telegram",
        ),
      ).rejects.toThrow(ActionNotFoundError);
    });
  });

  describe("retryPublish", () => {
    it("resets a failed publish job back to pending and records the channel", async () => {
      const { niche, video } = await seedReadyVideo();
      const scheduled = await seedScheduledPost(db, video.id, niche.id);
      const job = await seedPublishJob(db, scheduled.id, {
        status: "failed",
        attemptCount: 2,
        lastError: "TikTok API rate limited",
      });

      const updated = await retryPublish(db, job.id, "telegram");

      expect(updated.status).toBe("pending");
      expect(updated.lastError).toBeNull();
      expect(updated.updatedVia).toBe("telegram");
    });

    it("refuses to retry a publish job that isn't failed", async () => {
      const { niche, video } = await seedReadyVideo();
      const scheduled = await seedScheduledPost(db, video.id, niche.id);
      const job = await seedPublishJob(db, scheduled.id, { status: "pending" });

      await expect(retryPublish(db, job.id, "web")).rejects.toThrow(InvalidActionStateError);
    });

    it("throws ActionNotFoundError for an unknown publish job id", async () => {
      await expect(retryPublish(db, "00000000-0000-0000-0000-000000000000", "web")).rejects.toThrow(
        ActionNotFoundError,
      );
    });
  });
});
