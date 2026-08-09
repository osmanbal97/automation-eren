import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { generationJobs, ideas, videos } from "@/db/schema";
import { uploadFile } from "@/lib/blob";
import type { ErrorLogStore } from "@/lib/error-log";
import { callWithRetry } from "@/lib/resilient-client";
import { ActionNotFoundError, InvalidActionStateError } from "./errors";

/**
 * US-017: once a generation_jobs row is complete, its video (and thumbnail,
 * when the provider reports one) needs to move out of the provider's own
 * hosting and into our Vercel Blob store -- provider URLs aren't guaranteed
 * to stay valid indefinitely, and scheduling/publishing needs a URL we
 * control. Kept as its own module rather than folded into generation-jobs.ts
 * so the download-then-upload flow is unit-testable in isolation.
 */

export interface StoreVideoOptions {
  /** Injectable so tests never hit the network -- same seam every other external client uses. */
  fetchImpl?: typeof fetch;
  /** Injectable so tests never touch Vercel Blob. */
  uploadFileImpl?: typeof uploadFile;
  errorLogStore?: ErrorLogStore;
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

async function downloadFile(url: string, label: string, options: StoreVideoOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await callWithRetry({
    provider: "blob-source",
    operation: `download-${label}`,
    execute: () => fetchImpl(url),
    errorLogStore: options.errorLogStore,
    payloadSummary: url,
    maxAttempts: options.maxAttempts,
    baseDelayMs: options.baseDelayMs,
    sleep: options.sleep,
    random: options.random,
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${label} from ${url}: HTTP ${response.status}`);
  }
  return {
    body: await response.arrayBuffer(),
    contentType: response.headers.get("content-type"),
  };
}

/**
 * Downloads a completed job's video (and thumbnail, if the provider exposes
 * one) and re-uploads both into our own Blob store, then creates the
 * `videos` row that the review queue / scheduler build on. Idempotent: if a
 * video already exists for this job (e.g. a duplicate poll tick), the
 * existing row is returned rather than storing a second copy.
 */
export async function storeCompletedVideo(db: Database, jobId: string, options: StoreVideoOptions = {}) {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
  if (!job) {
    throw new ActionNotFoundError("GenerationJob", jobId);
  }
  if (job.status !== "complete" || !job.resultVideoUrl) {
    throw new InvalidActionStateError("GenerationJob", jobId, ["complete with a result video"], job.status);
  }

  const [existing] = await db.select().from(videos).where(eq(videos.generationJobId, jobId));
  if (existing) {
    return existing;
  }

  const [idea] = await db.select().from(ideas).where(eq(ideas.id, job.ideaId));
  if (!idea) {
    throw new ActionNotFoundError("Idea", job.ideaId);
  }

  const upload = options.uploadFileImpl ?? uploadFile;

  const video = await downloadFile(job.resultVideoUrl, "video", options);
  const videoUpload = await upload(`videos/${idea.id}/${job.id}.mp4`, video.body, {
    contentType: video.contentType ?? "video/mp4",
  });

  let thumbnailBlobUrl: string | null = null;
  if (job.thumbnailSourceUrl) {
    const thumbnail = await downloadFile(job.thumbnailSourceUrl, "thumbnail", options);
    const thumbnailUpload = await upload(`videos/${idea.id}/${job.id}-thumb.jpg`, thumbnail.body, {
      contentType: thumbnail.contentType ?? "image/jpeg",
    });
    thumbnailBlobUrl = thumbnailUpload.url;
  }

  const specs = idea.generationSpecs as { durationSeconds?: number } | null;

  const [created] = await db
    .insert(videos)
    .values({
      nicheId: idea.nicheId,
      ideaId: idea.id,
      generationJobId: job.id,
      blobUrl: videoUpload.url,
      thumbnailBlobUrl,
      sizeBytes: videoUpload.sizeBytes,
      durationSeconds: specs?.durationSeconds != null ? specs.durationSeconds.toFixed(2) : null,
      caption: idea.caption,
      hashtags: idea.hashtags,
    })
    .returning();

  return created;
}
