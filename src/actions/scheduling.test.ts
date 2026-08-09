import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { ActionNotFoundError, InvalidActionStateError } from "./errors";
import { listScheduledPostsForVideo, listUpcomingScheduledPosts, schedulePost, SchedulingCapExceededError } from "./scheduling";
import { seedGenerationJob, seedIdea, seedNiche, seedProvider, seedScheduledPost, seedVideo } from "./test-helpers";

describe("scheduling actions", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  async function seedReadyVideo(targetPostsPerDay: Record<string, number> = { tiktok: 2, instagram: 1, youtube: 0 }) {
    const niche = await seedNiche(db, { targetPostsPerDay });
    const provider = await seedProvider(db);
    const idea = await seedIdea(db, niche.id, { providerId: provider.id });
    const job = await seedGenerationJob(db, idea.id, provider.id, { status: "complete" });
    const video = await seedVideo(db, niche.id, idea.id, job.id, { status: "ready_to_schedule" });
    return { niche, video };
  }

  it("schedules a video onto one platform, creating one scheduled_posts row", async () => {
    const { video } = await seedReadyVideo();
    const scheduledAt = new Date("2026-08-15T14:00:00Z");

    const rows = await schedulePost(db, video.id, ["tiktok"], scheduledAt, "web");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      videoId: video.id,
      nicheId: video.nicheId,
      platform: "tiktok",
      createdVia: "web",
      status: "scheduled",
    });
    expect(rows[0].scheduledAt).toEqual(scheduledAt);
  });

  it("schedules a video onto multiple platforms at once, one row per platform", async () => {
    const { video } = await seedReadyVideo();
    const scheduledAt = new Date("2026-08-15T14:00:00Z");

    const rows = await schedulePost(db, video.id, ["tiktok", "instagram"], scheduledAt, "telegram");

    expect(rows.map((row) => row.platform).sort()).toEqual(["instagram", "tiktok"]);
    expect(rows.every((row) => row.createdVia === "telegram")).toBe(true);
  });

  it("throws ActionNotFoundError for an unknown video id", async () => {
    await expect(
      schedulePost(db, "00000000-0000-0000-0000-000000000000", ["tiktok"], new Date(), "web"),
    ).rejects.toThrow(ActionNotFoundError);
  });

  it("throws InvalidActionStateError when the video isn't ready_to_schedule", async () => {
    const niche = await seedNiche(db);
    const provider = await seedProvider(db);
    const idea = await seedIdea(db, niche.id, { providerId: provider.id });
    const job = await seedGenerationJob(db, idea.id, provider.id, { status: "complete" });
    const video = await seedVideo(db, niche.id, idea.id, job.id); // default status: pending_review

    await expect(schedulePost(db, video.id, ["tiktok"], new Date(), "web")).rejects.toThrow(
      InvalidActionStateError,
    );
  });

  it("throws when no platforms are given", async () => {
    const { video } = await seedReadyVideo();
    await expect(schedulePost(db, video.id, [], new Date(), "web")).rejects.toThrow(
      "Select at least one platform",
    );
  });

  it("blocks scheduling once a platform's daily cap is reached", async () => {
    const { video } = await seedReadyVideo({ tiktok: 1, instagram: 1, youtube: 0 });
    const scheduledAt = new Date("2026-08-15T14:00:00Z");

    await schedulePost(db, video.id, ["tiktok"], scheduledAt, "web");

    await expect(
      schedulePost(db, video.id, ["tiktok"], new Date("2026-08-15T20:00:00Z"), "web"),
    ).rejects.toThrow(SchedulingCapExceededError);
  });

  it("a cap of 0 blocks scheduling onto that platform entirely", async () => {
    const { video } = await seedReadyVideo({ tiktok: 2, instagram: 1, youtube: 0 });

    await expect(
      schedulePost(db, video.id, ["youtube"], new Date("2026-08-15T14:00:00Z"), "web"),
    ).rejects.toThrow(SchedulingCapExceededError);
  });

  it("a full platform in a multi-platform request blocks the whole batch (no partial scheduling)", async () => {
    const { video } = await seedReadyVideo({ tiktok: 2, instagram: 0, youtube: 0 });

    await expect(
      schedulePost(db, video.id, ["tiktok", "instagram"], new Date("2026-08-15T14:00:00Z"), "web"),
    ).rejects.toThrow(SchedulingCapExceededError);

    const existing = await listScheduledPostsForVideo(db, video.id);
    expect(existing).toHaveLength(0);
  });

  it("the cap only counts the same UTC calendar day, not other days", async () => {
    const { video } = await seedReadyVideo({ tiktok: 1, instagram: 1, youtube: 0 });

    await schedulePost(db, video.id, ["tiktok"], new Date("2026-08-15T23:00:00Z"), "web");

    await expect(
      schedulePost(db, video.id, ["tiktok"], new Date("2026-08-16T01:00:00Z"), "web"),
    ).resolves.toHaveLength(1);
  });

  it("a failed scheduled_posts row doesn't count against the cap", async () => {
    const { video } = await seedReadyVideo({ tiktok: 1, instagram: 1, youtube: 0 });
    await seedScheduledPost(db, video.id, video.nicheId, {
      platform: "tiktok",
      scheduledAt: new Date("2026-08-15T10:00:00Z"),
      status: "failed",
    });

    await expect(
      schedulePost(db, video.id, ["tiktok"], new Date("2026-08-15T14:00:00Z"), "web"),
    ).resolves.toHaveLength(1);
  });

  it("listScheduledPostsForVideo returns rows ordered by scheduled time", async () => {
    const { video } = await seedReadyVideo({ tiktok: 5, instagram: 5, youtube: 5 });
    await schedulePost(db, video.id, ["instagram"], new Date("2026-08-16T10:00:00Z"), "web");
    await schedulePost(db, video.id, ["tiktok"], new Date("2026-08-15T10:00:00Z"), "web");

    const rows = await listScheduledPostsForVideo(db, video.id);

    expect(rows.map((row) => row.platform)).toEqual(["tiktok", "instagram"]);
  });

  describe("listUpcomingScheduledPosts", () => {
    it("returns future scheduled/awaiting/publishing posts, soonest first", async () => {
      const { video, niche } = await seedReadyVideo({ tiktok: 5, instagram: 5, youtube: 5 });
      const farFuture = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const nearFuture = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await seedScheduledPost(db, video.id, video.nicheId, {
        platform: "instagram",
        scheduledAt: farFuture,
        status: "awaiting_platform_approval",
      });
      await seedScheduledPost(db, video.id, video.nicheId, {
        platform: "tiktok",
        scheduledAt: nearFuture,
        status: "scheduled",
      });

      const upcoming = await listUpcomingScheduledPosts(db);

      expect(upcoming.map((row) => row.post.platform)).toEqual(["tiktok", "instagram"]);
      expect(upcoming.every((row) => row.nicheName === niche.name)).toBe(true);
      expect(upcoming.every((row) => row.video.id === video.id)).toBe(true);
    });

    it("excludes posts already in the past", async () => {
      const { video } = await seedReadyVideo();
      await seedScheduledPost(db, video.id, video.nicheId, {
        platform: "tiktok",
        scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
        status: "scheduled",
      });

      const upcoming = await listUpcomingScheduledPosts(db);

      expect(upcoming).toHaveLength(0);
    });

    it("excludes published and failed posts", async () => {
      const { video } = await seedReadyVideo({ tiktok: 5, instagram: 5, youtube: 5 });
      const soon = new Date(Date.now() + 60 * 60 * 1000);
      await seedScheduledPost(db, video.id, video.nicheId, { platform: "tiktok", scheduledAt: soon, status: "published" });
      await seedScheduledPost(db, video.id, video.nicheId, { platform: "instagram", scheduledAt: soon, status: "failed" });

      const upcoming = await listUpcomingScheduledPosts(db);

      expect(upcoming).toHaveLength(0);
    });

    it("caps the number of rows returned", async () => {
      const { video } = await seedReadyVideo({ tiktok: 5, instagram: 5, youtube: 5 });
      for (let i = 0; i < 5; i++) {
        await seedScheduledPost(db, video.id, video.nicheId, {
          platform: i % 2 === 0 ? "tiktok" : "instagram",
          scheduledAt: new Date(Date.now() + (i + 1) * 60 * 60 * 1000),
          status: "scheduled",
        });
      }

      const upcoming = await listUpcomingScheduledPosts(db, 2);

      expect(upcoming).toHaveLength(2);
    });
  });
});
