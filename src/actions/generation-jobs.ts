import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { generationJobs, ideas, videoProviders } from "@/db/schema";
import type { ErrorLogStore } from "@/lib/error-log";
import { getVideoProvider } from "@/lib/video-providers/registry";
import type { GenerationSpecs, VideoProvider } from "@/lib/video-providers/types";
import { ActionNotFoundError, InvalidActionStateError } from "./errors";
import { approveIdea } from "./ideas";
import { storeCompletedVideo as defaultStoreCompletedVideo, type StoreVideoOptions } from "./store-video";
import type { Channel } from "./types";

/**
 * US-016: the generation queue. Approving an idea turns it into a
 * generation_jobs row submitted to the idea's provider via the US-007 adapter
 * registry; a cron-driven poller then advances each in-flight job's status.
 *
 * Adapter resolution is injectable (`resolveProvider`) so tests can drive the
 * whole queue against a fake VideoProvider without touching the network or
 * needing a real HIGGSFIELD_API_KEY -- the same seam the rest of the codebase
 * uses for external clients.
 */

export type ProviderResolver = (adapterKey: string) => VideoProvider;

export interface GenerationQueueOptions {
  resolveProvider?: ProviderResolver;
  errorLogStore?: ErrorLogStore;
  /** Attempts a single job gets before the poller gives up and marks it failed. */
  maxAttempts?: number;
  /** Injectable (US-017) so tests can assert a completed job triggers storage
   * without exercising the real network/Blob layer. */
  storeCompletedVideo?: (db: Database, jobId: string, options?: StoreVideoOptions) => Promise<unknown>;
}

const DEFAULT_MAX_ATTEMPTS = 4;

function resolverFrom(options: GenerationQueueOptions): ProviderResolver {
  return options.resolveProvider ?? ((adapterKey) => getVideoProvider(adapterKey, {
    errorLogStore: options.errorLogStore,
  }));
}

function isValidGenerationSpecs(specs: unknown): specs is GenerationSpecs {
  return (
    typeof specs === "object" &&
    specs !== null &&
    typeof (specs as GenerationSpecs).resolution === "string" &&
    typeof (specs as GenerationSpecs).durationSeconds === "number"
  );
}

async function loadIdeaForGeneration(db: Database, ideaId: string) {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
  if (!idea) {
    throw new ActionNotFoundError("Idea", ideaId);
  }
  if (!idea.providerId) {
    throw new InvalidActionStateError("Idea", ideaId, ["a provider set"], "no provider");
  }
  if (!isValidGenerationSpecs(idea.generationSpecs)) {
    throw new InvalidActionStateError("Idea", ideaId, ["complete generation specs"], "incomplete specs");
  }

  const [provider] = await db
    .select()
    .from(videoProviders)
    .where(eq(videoProviders.id, idea.providerId));
  if (!provider) {
    throw new ActionNotFoundError("VideoProvider", idea.providerId);
  }

  return { idea, provider, specs: idea.generationSpecs };
}

/**
 * Creates a generation_jobs row for an idea and submits it to the provider.
 *
 * The row is inserted *before* the provider call so a submit failure is still
 * visible in the dashboard as a failed job with its error, rather than
 * vanishing. A submit failure marks the job failed but does not throw, so an
 * approval flow (web or Telegram) never 500s just because the vendor is down --
 * the operator sees the failure on the job and can retry.
 */
export async function enqueueGenerationJob(
  db: Database,
  ideaId: string,
  options: GenerationQueueOptions = {},
) {
  const { idea, provider, specs } = await loadIdeaForGeneration(db, ideaId);

  const [job] = await db
    .insert(generationJobs)
    .values({ ideaId: idea.id, providerId: provider.id, status: "queued", attemptCount: 1 })
    .returning();

  try {
    const adapter = resolverFrom(options)(provider.adapterKey);
    const externalJobId = await adapter.submit(idea.prompt, specs);
    const [submitted] = await db
      .update(generationJobs)
      .set({ externalJobId, status: "processing", lastError: null, updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id))
      .returning();
    return submitted;
  } catch (error) {
    const [failed] = await db
      .update(generationJobs)
      .set({ status: "failed", lastError: (error as Error).message, updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id))
      .returning();
    return failed;
  }
}

/**
 * Advances one in-flight job by asking its provider for the current status.
 *
 * Transient failures (the provider throwing, e.g. a 5xx that already exhausted
 * the adapter's own retries) bump attempt_count and leave the job in-flight so
 * the next cron tick tries again -- until maxAttempts, after which it's marked
 * failed with the last error. A provider reporting "complete" only records the
 * result URL here; downloading it into Blob storage is US-017's job.
 */
export async function pollGenerationJob(
  db: Database,
  jobId: string,
  options: GenerationQueueOptions = {},
) {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
  if (!job) {
    throw new ActionNotFoundError("GenerationJob", jobId);
  }
  if (job.status === "complete" || job.status === "failed") {
    return job;
  }
  if (!job.externalJobId) {
    const [failed] = await db
      .update(generationJobs)
      .set({ status: "failed", lastError: "Job has no external job id to poll", updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id))
      .returning();
    return failed;
  }

  const [provider] = await db
    .select()
    .from(videoProviders)
    .where(eq(videoProviders.id, job.providerId));
  if (!provider) {
    throw new ActionNotFoundError("VideoProvider", job.providerId);
  }

  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  try {
    const adapter = resolverFrom(options)(provider.adapterKey);
    const status = await adapter.getStatus(job.externalJobId);

    if (status === "complete") {
      const result = await adapter.getResult(job.externalJobId);
      const [completed] = await db
        .update(generationJobs)
        .set({
          status: "complete",
          resultVideoUrl: result.videoUrl,
          thumbnailSourceUrl: result.thumbnailUrl ?? null,
          actualCost: result.actualCost != null ? result.actualCost.toFixed(4) : null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(generationJobs.id, job.id))
        .returning();

      // US-017: pull the video (and thumbnail, if any) into our own Blob store now
      // that the provider considers the job done. The generation itself already
      // succeeded, so a storage failure doesn't revert status -- it's surfaced via
      // lastError instead, and a manual retry can re-run storeCompletedVideo later.
      const storeVideo = options.storeCompletedVideo ?? defaultStoreCompletedVideo;
      try {
        await storeVideo(db, completed.id, { errorLogStore: options.errorLogStore });
        return completed;
      } catch (error) {
        const [flagged] = await db
          .update(generationJobs)
          .set({ lastError: `Video generated but storage failed: ${(error as Error).message}`, updatedAt: new Date() })
          .where(eq(generationJobs.id, job.id))
          .returning();
        return flagged;
      }
    }

    if (status === "failed") {
      const [failed] = await db
        .update(generationJobs)
        .set({ status: "failed", lastError: "Provider reported the job failed", updatedAt: new Date() })
        .where(eq(generationJobs.id, job.id))
        .returning();
      return failed;
    }

    const [advanced] = await db
      .update(generationJobs)
      .set({ status, updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id))
      .returning();
    return advanced;
  } catch (error) {
    const attemptCount = job.attemptCount + 1;
    const exhausted = attemptCount >= maxAttempts;
    const [updated] = await db
      .update(generationJobs)
      .set({
        attemptCount,
        status: exhausted ? "failed" : job.status,
        lastError: (error as Error).message,
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, job.id))
      .returning();
    return updated;
  }
}

/** Every job the poller should still be advancing. */
export async function listInFlightGenerationJobs(db: Database) {
  return db
    .select()
    .from(generationJobs)
    .where(inArray(generationJobs.status, ["queued", "processing"]));
}

/** Polls every in-flight job, returning a per-status tally for the cron response. */
export async function pollAllGenerationJobs(db: Database, options: GenerationQueueOptions = {}) {
  const inFlight = await listInFlightGenerationJobs(db);
  const summary = { polled: inFlight.length, complete: 0, failed: 0, stillRunning: 0 };

  for (const job of inFlight) {
    // Sequential on purpose: these hit a paid third-party API, and the batch is
    // small (one job per approved idea). Parallelising would risk tripping the
    // provider's own rate limits for no meaningful latency win on a cron tick.
    const updated = await pollGenerationJob(db, job.id, options);
    if (updated.status === "complete") {
      summary.complete += 1;
    } else if (updated.status === "failed") {
      summary.failed += 1;
    } else {
      summary.stillRunning += 1;
    }
  }

  return summary;
}

/**
 * Re-submits an existing idea for generation after its prompt was edited or
 * rewritten by the prompt optimizer (the US-016 regenerate criterion added
 * during the redesign). Records the originating channel on the idea so we keep
 * the same web/Telegram provenance tracking every other mutating action has.
 *
 * Deliberately does not delete the previous job: the old attempt stays in the
 * table as history, which is what makes "this prompt produced that bad video"
 * auditable later.
 */
export async function regenerateVideo(
  db: Database,
  ideaId: string,
  channel: Channel,
  options: GenerationQueueOptions = {},
) {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
  if (!idea) {
    throw new ActionNotFoundError("Idea", ideaId);
  }

  await db
    .update(ideas)
    .set({ updatedVia: channel, updatedAt: new Date() })
    .where(eq(ideas.id, ideaId));

  return enqueueGenerationJob(db, ideaId, options);
}

/**
 * Approves an idea and immediately queues its generation job -- the US-016
 * criterion that "approving an idea creates a generation_jobs row and submits
 * it". Lives here rather than in either caller so the web review queue and the
 * Telegram bot share one definition of what approval does.
 *
 * A queueing failure never undoes the approval: the idea stays approved and the
 * failure is visible on the job row (or returned as `job: null` when the idea
 * isn't generatable yet, e.g. no provider picked). Approving is the operator's
 * decision; whether the vendor accepted the submission is separate.
 */
export async function approveIdeaAndEnqueue(
  db: Database,
  ideaId: string,
  channel: Channel,
  options: GenerationQueueOptions = {},
) {
  const idea = await approveIdea(db, ideaId, channel);
  try {
    const job = await enqueueGenerationJob(db, ideaId, options);
    return { idea, job, queueError: null as string | null };
  } catch (error) {
    return { idea, job: null, queueError: (error as Error).message };
  }
}

/** Jobs for one niche's ideas, newest first -- backs the dashboard status list. */
export async function listGenerationJobsForNiche(db: Database, nicheId: string) {
  return db
    .select({
      job: generationJobs,
      ideaTitle: ideas.title,
      providerName: videoProviders.name,
    })
    .from(generationJobs)
    .innerJoin(ideas, eq(generationJobs.ideaId, ideas.id))
    .innerJoin(videoProviders, eq(generationJobs.providerId, videoProviders.id))
    .where(eq(ideas.nicheId, nicheId))
    .orderBy(generationJobs.createdAt);
}

/** True when this idea already has a job that is queued, processing, or complete. */
export async function hasActiveGenerationJob(db: Database, ideaId: string) {
  const rows = await db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.ideaId, ideaId),
        inArray(generationJobs.status, ["queued", "processing", "complete"]),
      ),
    );
  return rows.length > 0;
}
