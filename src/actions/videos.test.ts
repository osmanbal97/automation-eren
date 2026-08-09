import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { ActionNotFoundError, InvalidActionStateError } from "./errors";
import { seedGenerationJob, seedIdea, seedNiche, seedProvider, seedVideo } from "./test-helpers";
import { approveVideo, editVideoCaption, editVideoHashtags, rejectVideo } from "./videos";

describe("video actions", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  async function seedPendingVideo() {
    const niche = await seedNiche(db);
    const provider = await seedProvider(db);
    const idea = await seedIdea(db, niche.id, { providerId: provider.id });
    const job = await seedGenerationJob(db, idea.id, provider.id, { status: "complete" });
    return seedVideo(db, niche.id, idea.id, job.id);
  }

  it("approveVideo moves a pending video to ready_to_schedule and records the channel", async () => {
    const video = await seedPendingVideo();

    const updated = await approveVideo(db, video.id, "web");

    expect(updated.status).toBe("ready_to_schedule");
    expect(updated.approvedVia).toBe("web");
  });

  it("approveVideo rejects a non-pending video with a typed error", async () => {
    const video = await seedPendingVideo();
    await approveVideo(db, video.id, "web");

    await expect(approveVideo(db, video.id, "web")).rejects.toThrow(InvalidActionStateError);
  });

  it("approveVideo throws ActionNotFoundError for an unknown id", async () => {
    await expect(approveVideo(db, "00000000-0000-0000-0000-000000000000", "web")).rejects.toThrow(
      ActionNotFoundError,
    );
  });

  it("rejectVideo marks a video rejected via the triggering channel", async () => {
    const video = await seedPendingVideo();

    const updated = await rejectVideo(db, video.id, "telegram");

    expect(updated.status).toBe("rejected");
    expect(updated.updatedVia).toBe("telegram");
  });

  it("editVideoCaption updates the caption and records the channel", async () => {
    const video = await seedPendingVideo();

    const updated = await editVideoCaption(db, video.id, "updated caption", "telegram");

    expect(updated.caption).toBe("updated caption");
    expect(updated.updatedVia).toBe("telegram");
  });

  it("editVideoHashtags updates the hashtag list and records the channel", async () => {
    const video = await seedPendingVideo();

    const updated = await editVideoHashtags(db, video.id, ["trippy", "pov"], "web");

    expect(updated.hashtags).toEqual(["trippy", "pov"]);
    expect(updated.updatedVia).toBe("web");
  });

  it("editVideoHashtags throws ActionNotFoundError for an unknown id", async () => {
    await expect(
      editVideoHashtags(db, "00000000-0000-0000-0000-000000000000", ["x"], "web"),
    ).rejects.toThrow(ActionNotFoundError);
  });
});
