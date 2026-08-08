import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { videos } from "@/db/schema";
import type { UploadFileResult } from "@/lib/blob";
import { ActionNotFoundError, InvalidActionStateError } from "./errors";
import { storeCompletedVideo } from "./store-video";
import { seedGenerationJob, seedIdea, seedNiche, seedProvider, seedVideo } from "./test-helpers";

const SPECS = { resolution: "1080x1920", durationSeconds: 8, aspectRatio: "9:16" };

/** Minimal fetch Response stand-in -- only the members storeCompletedVideo touches. */
function fakeResponse(
  overrides: { ok?: boolean; status?: number; contentType?: string | null; body?: ArrayBuffer } = {},
) {
  const body = overrides.body ?? new TextEncoder().encode("fake-bytes").buffer;
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    headers: { get: () => overrides.contentType ?? "video/mp4" },
    arrayBuffer: () => Promise.resolve(body),
  } as unknown as Response;
}

function fakeUpload(overrides: Partial<UploadFileResult> = {}): UploadFileResult {
  return {
    url: "https://blob.example.com/videos/x.mp4",
    pathname: "videos/x.mp4",
    contentType: "video/mp4",
    sizeBytes: 1024,
    ...overrides,
  };
}

/** Seeds a niche + provider + idea + a completed generation job. */
async function seedCompletedJob(db: Database, overrides: Record<string, unknown> = {}) {
  const niche = await seedNiche(db);
  const provider = await seedProvider(db);
  const idea = await seedIdea(db, niche.id, { providerId: provider.id, generationSpecs: SPECS });
  const job = await seedGenerationJob(db, idea.id, provider.id, {
    status: "complete",
    externalJobId: "ext-1",
    resultVideoUrl: "https://provider.example.com/video.mp4",
    ...overrides,
  });
  return { niche, provider, idea, job };
}

describe("storeCompletedVideo", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("throws for an unknown job", async () => {
    await expect(
      storeCompletedVideo(db, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(ActionNotFoundError);
  });

  it("refuses a job that isn't complete", async () => {
    const niche = await seedNiche(db);
    const provider = await seedProvider(db);
    const idea = await seedIdea(db, niche.id, { providerId: provider.id, generationSpecs: SPECS });
    const job = await seedGenerationJob(db, idea.id, provider.id, { status: "processing" });

    await expect(storeCompletedVideo(db, job.id)).rejects.toThrow(InvalidActionStateError);
  });

  it("refuses a complete job with no result video url", async () => {
    const niche = await seedNiche(db);
    const provider = await seedProvider(db);
    const idea = await seedIdea(db, niche.id, { providerId: provider.id, generationSpecs: SPECS });
    const job = await seedGenerationJob(db, idea.id, provider.id, { status: "complete" });

    await expect(storeCompletedVideo(db, job.id)).rejects.toThrow(InvalidActionStateError);
  });

  it("downloads the video, uploads it, and creates a videos row", async () => {
    const { niche, idea, job } = await seedCompletedJob(db);
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse());
    const uploadFileImpl = vi.fn().mockResolvedValue(fakeUpload());

    const video = await storeCompletedVideo(db, job.id, { fetchImpl, uploadFileImpl });

    expect(fetchImpl).toHaveBeenCalledWith(job.resultVideoUrl);
    expect(uploadFileImpl).toHaveBeenCalledWith(
      `videos/${idea.id}/${job.id}.mp4`,
      expect.anything(),
      expect.objectContaining({ contentType: "video/mp4" }),
    );
    expect(video.nicheId).toBe(niche.id);
    expect(video.ideaId).toBe(idea.id);
    expect(video.generationJobId).toBe(job.id);
    expect(video.blobUrl).toBe("https://blob.example.com/videos/x.mp4");
    expect(video.thumbnailBlobUrl).toBeNull();
    expect(video.caption).toBe(idea.caption);
    expect(video.durationSeconds).toBe("8.00");
  });

  it("also stores a thumbnail when the job has a thumbnail source url", async () => {
    const { job } = await seedCompletedJob(db, { thumbnailSourceUrl: "https://provider.example.com/thumb.jpg" });
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse());
    const uploadFileImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeUpload({ url: "https://blob.example.com/video.mp4" }))
      .mockResolvedValueOnce(fakeUpload({ url: "https://blob.example.com/thumb.jpg" }));

    const video = await storeCompletedVideo(db, job.id, { fetchImpl, uploadFileImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith("https://provider.example.com/thumb.jpg");
    expect(uploadFileImpl).toHaveBeenCalledTimes(2);
    expect(video.thumbnailBlobUrl).toBe("https://blob.example.com/thumb.jpg");
  });

  it("is idempotent: returns the existing video row without re-uploading", async () => {
    const { niche, idea, job } = await seedCompletedJob(db);
    const existing = await seedVideo(db, niche.id, idea.id, job.id, {
      blobUrl: "https://blob.example.com/already-there.mp4",
    });
    const fetchImpl = vi.fn();
    const uploadFileImpl = vi.fn();

    const video = await storeCompletedVideo(db, job.id, { fetchImpl, uploadFileImpl });

    expect(video.id).toBe(existing.id);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(uploadFileImpl).not.toHaveBeenCalled();

    const all = await db.select().from(videos).where(eq(videos.generationJobId, job.id));
    expect(all).toHaveLength(1);
  });

  it("propagates a download failure instead of creating a partial row", async () => {
    const { job } = await seedCompletedJob(db);
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 404 }));
    const uploadFileImpl = vi.fn();

    await expect(storeCompletedVideo(db, job.id, { fetchImpl, uploadFileImpl })).rejects.toThrow(/404/);
    expect(uploadFileImpl).not.toHaveBeenCalled();

    const all = await db.select().from(videos).where(eq(videos.generationJobId, job.id));
    expect(all).toHaveLength(0);
  });
});
