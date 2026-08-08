import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { generationJobs, ideas } from "@/db/schema";
import type { VideoJobStatus, VideoProvider, VideoResult } from "@/lib/video-providers/types";
import { ActionNotFoundError, InvalidActionStateError } from "./errors";
import {
  enqueueGenerationJob,
  hasActiveGenerationJob,
  listGenerationJobsForNiche,
  listInFlightGenerationJobs,
  pollAllGenerationJobs,
  pollGenerationJob,
  regenerateVideo,
} from "./generation-jobs";
import { seedGenerationJob, seedIdea, seedNiche, seedProvider } from "./test-helpers";

const SPECS = { resolution: "1080x1920", durationSeconds: 8, aspectRatio: "9:16" };

function fakeProvider(overrides: Partial<VideoProvider> = {}): VideoProvider {
  return {
    submit: vi.fn().mockResolvedValue("ext-job-1"),
    getStatus: vi.fn().mockResolvedValue("processing" as VideoJobStatus),
    getResult: vi.fn().mockResolvedValue({ videoUrl: "https://cdn.example.com/v.mp4" } as VideoResult),
    ...overrides,
  };
}

/** Seeds a niche + provider + an idea that is actually generatable. */
async function seedGeneratableIdea(db: Database) {
  const niche = await seedNiche(db);
  const provider = await seedProvider(db);
  const idea = await seedIdea(db, niche.id, { providerId: provider.id, generationSpecs: SPECS });
  return { niche, provider, idea };
}

describe("enqueueGenerationJob", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("throws for an unknown idea", async () => {
    await expect(
      enqueueGenerationJob(db, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(ActionNotFoundError);
  });

  it("refuses an idea with no provider set", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id, { generationSpecs: SPECS });
    await expect(enqueueGenerationJob(db, idea.id)).rejects.toThrow(InvalidActionStateError);
  });

  it("refuses an idea with incomplete generation specs", async () => {
    const niche = await seedNiche(db);
    const provider = await seedProvider(db);
    const idea = await seedIdea(db, niche.id, { providerId: provider.id, generationSpecs: {} });
    await expect(enqueueGenerationJob(db, idea.id)).rejects.toThrow(InvalidActionStateError);
  });

  it("creates a job, submits it to the provider, and records the external id", async () => {
    const { idea } = await seedGeneratableIdea(db);
    const provider = fakeProvider();

    const job = await enqueueGenerationJob(db, idea.id, { resolveProvider: () => provider });

    expect(job.status).toBe("processing");
    expect(job.externalJobId).toBe("ext-job-1");
    expect(job.ideaId).toBe(idea.id);
    expect(provider.submit).toHaveBeenCalledWith(idea.prompt, expect.objectContaining(SPECS));

    const [row] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id));
    expect(row.status).toBe("processing");
  });

  it("resolves the adapter by the provider's adapter_key", async () => {
    const niche = await seedNiche(db);
    const provider = await seedProvider(db, { name: "Omni", adapterKey: "omni" });
    const idea = await seedIdea(db, niche.id, { providerId: provider.id, generationSpecs: SPECS });
    const resolveProvider = vi.fn().mockReturnValue(fakeProvider());

    await enqueueGenerationJob(db, idea.id, { resolveProvider });

    expect(resolveProvider).toHaveBeenCalledWith("omni");
  });

  it("persists a failed job with the error instead of throwing when submit fails", async () => {
    const { idea } = await seedGeneratableIdea(db);
    const provider = fakeProvider({
      submit: vi.fn().mockRejectedValue(new Error("provider exploded")),
    });

    const job = await enqueueGenerationJob(db, idea.id, { resolveProvider: () => provider });

    expect(job.status).toBe("failed");
    expect(job.lastError).toBe("provider exploded");
  });
});

describe("pollGenerationJob", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("throws for an unknown job", async () => {
    await expect(
      pollGenerationJob(db, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(ActionNotFoundError);
  });

  it("records the result url and actual cost when the provider reports complete", async () => {
    const { idea, provider: providerRow } = await seedGeneratableIdea(db);
    const job = await seedGenerationJob(db, idea.id, providerRow.id, {
      status: "processing",
      externalJobId: "ext-1",
    });
    const provider = fakeProvider({
      getStatus: vi.fn().mockResolvedValue("complete"),
      getResult: vi.fn().mockResolvedValue({ videoUrl: "https://cdn/x.mp4", actualCost: 1.5 }),
    });

    const updated = await pollGenerationJob(db, job.id, { resolveProvider: () => provider });

    expect(updated.status).toBe("complete");
    expect(updated.resultVideoUrl).toBe("https://cdn/x.mp4");
    expect(updated.actualCost).toBe("1.5000");
  });

  it("marks the job failed when the provider reports failure", async () => {
    const { idea, provider: providerRow } = await seedGeneratableIdea(db);
    const job = await seedGenerationJob(db, idea.id, providerRow.id, {
      status: "processing",
      externalJobId: "ext-1",
    });
    const provider = fakeProvider({ getStatus: vi.fn().mockResolvedValue("failed") });

    const updated = await pollGenerationJob(db, job.id, { resolveProvider: () => provider });

    expect(updated.status).toBe("failed");
    expect(updated.lastError).toMatch(/failed/i);
  });

  it("leaves a still-processing job in flight without fetching a result", async () => {
    const { idea, provider: providerRow } = await seedGeneratableIdea(db);
    const job = await seedGenerationJob(db, idea.id, providerRow.id, {
      status: "queued",
      externalJobId: "ext-1",
    });
    const provider = fakeProvider({ getStatus: vi.fn().mockResolvedValue("processing") });

    const updated = await pollGenerationJob(db, job.id, { resolveProvider: () => provider });

    expect(updated.status).toBe("processing");
    expect(provider.getResult).not.toHaveBeenCalled();
  });

  it("bumps attempt_count and stays in flight on a transient provider error", async () => {
    const { idea, provider: providerRow } = await seedGeneratableIdea(db);
    const job = await seedGenerationJob(db, idea.id, providerRow.id, {
      status: "processing",
      externalJobId: "ext-1",
      attemptCount: 1,
    });
    const provider = fakeProvider({
      getStatus: vi.fn().mockRejectedValue(new Error("503 upstream")),
    });

    const updated = await pollGenerationJob(db, job.id, {
      resolveProvider: () => provider,
      maxAttempts: 4,
    });

    expect(updated.status).toBe("processing");
    expect(updated.attemptCount).toBe(2);
    expect(updated.lastError).toBe("503 upstream");
  });

  it("marks the job failed once attempts are exhausted", async () => {
    const { idea, provider: providerRow } = await seedGeneratableIdea(db);
    const job = await seedGenerationJob(db, idea.id, providerRow.id, {
      status: "processing",
      externalJobId: "ext-1",
      attemptCount: 3,
    });
    const provider = fakeProvider({
      getStatus: vi.fn().mockRejectedValue(new Error("still down")),
    });

    const updated = await pollGenerationJob(db, job.id, {
      resolveProvider: () => provider,
      maxAttempts: 4,
    });

    expect(updated.status).toBe("failed");
    expect(updated.attemptCount).toBe(4);
    expect(updated.lastError).toBe("still down");
  });

  it("is a no-op for an already-settled job", async () => {
    const { idea, provider: providerRow } = await seedGeneratableIdea(db);
    const job = await seedGenerationJob(db, idea.id, providerRow.id, {
      status: "complete",
      externalJobId: "ext-1",
    });
    const provider = fakeProvider();

    const updated = await pollGenerationJob(db, job.id, { resolveProvider: () => provider });

    expect(updated.status).toBe("complete");
    expect(provider.getStatus).not.toHaveBeenCalled();
  });

  it("fails a job that has no external id to poll", async () => {
    const { idea, provider: providerRow } = await seedGeneratableIdea(db);
    const job = await seedGenerationJob(db, idea.id, providerRow.id, { status: "queued" });

    const updated = await pollGenerationJob(db, job.id, { resolveProvider: () => fakeProvider() });

    expect(updated.status).toBe("failed");
    expect(updated.lastError).toMatch(/no external job id/i);
  });
});

describe("pollAllGenerationJobs", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("polls only in-flight jobs and tallies the outcomes", async () => {
    const { niche, idea, provider: providerRow } = await seedGeneratableIdea(db);
    const otherIdea = await seedIdea(db, niche.id, {
      providerId: providerRow.id,
      generationSpecs: SPECS,
      title: "Second idea",
    });

    await seedGenerationJob(db, idea.id, providerRow.id, {
      status: "processing",
      externalJobId: "ext-1",
    });
    await seedGenerationJob(db, otherIdea.id, providerRow.id, {
      status: "queued",
      externalJobId: "ext-2",
    });
    // Already settled -- must be ignored entirely.
    await seedGenerationJob(db, idea.id, providerRow.id, {
      status: "complete",
      externalJobId: "ext-3",
    });

    const inFlight = await listInFlightGenerationJobs(db);
    expect(inFlight).toHaveLength(2);

    const provider = fakeProvider({ getStatus: vi.fn().mockResolvedValue("complete") });
    const summary = await pollAllGenerationJobs(db, { resolveProvider: () => provider });

    expect(summary).toEqual({ polled: 2, complete: 2, failed: 0, stillRunning: 0 });
    expect(provider.getStatus).toHaveBeenCalledTimes(2);
  });
});

describe("regenerateVideo", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("throws for an unknown idea", async () => {
    await expect(
      regenerateVideo(db, "00000000-0000-0000-0000-000000000000", "web"),
    ).rejects.toThrow(ActionNotFoundError);
  });

  it("submits a fresh job with the current prompt and records the channel", async () => {
    const { idea, provider: providerRow } = await seedGeneratableIdea(db);
    const original = await seedGenerationJob(db, idea.id, providerRow.id, {
      status: "failed",
      externalJobId: "ext-old",
      lastError: "bad output",
    });

    await db.update(ideas).set({ prompt: "a much better prompt" }).where(eq(ideas.id, idea.id));

    const provider = fakeProvider({ submit: vi.fn().mockResolvedValue("ext-new") });
    const job = await regenerateVideo(db, idea.id, "telegram", { resolveProvider: () => provider });

    expect(job.id).not.toBe(original.id);
    expect(job.externalJobId).toBe("ext-new");
    expect(provider.submit).toHaveBeenCalledWith("a much better prompt", expect.anything());

    const [updatedIdea] = await db.select().from(ideas).where(eq(ideas.id, idea.id));
    expect(updatedIdea.updatedVia).toBe("telegram");

    // The previous attempt is kept as history rather than deleted.
    const all = await db.select().from(generationJobs).where(eq(generationJobs.ideaId, idea.id));
    expect(all).toHaveLength(2);
  });
});

describe("generation job queries", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("lists jobs for a niche with idea title and provider name", async () => {
    const { niche, idea, provider } = await seedGeneratableIdea(db);
    await seedGenerationJob(db, idea.id, provider.id, {
      status: "failed",
      lastError: "boom",
    });

    const rows = await listGenerationJobsForNiche(db, niche.id);

    expect(rows).toHaveLength(1);
    expect(rows[0].ideaTitle).toBe(idea.title);
    expect(rows[0].providerName).toBe(provider.name);
    expect(rows[0].job.lastError).toBe("boom");
  });

  it("does not leak jobs from another niche", async () => {
    const { provider } = await seedGeneratableIdea(db);
    const otherNiche = await seedNiche(db, { name: "Wholesome" });
    const otherIdea = await seedIdea(db, otherNiche.id, {
      providerId: provider.id,
      generationSpecs: SPECS,
    });
    await seedGenerationJob(db, otherIdea.id, provider.id);

    const rows = await listGenerationJobsForNiche(db, otherNiche.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].job.ideaId).toBe(otherIdea.id);
  });

  it("reports whether an idea already has an active job", async () => {
    const { idea, provider } = await seedGeneratableIdea(db);
    expect(await hasActiveGenerationJob(db, idea.id)).toBe(false);

    await seedGenerationJob(db, idea.id, provider.id, { status: "failed" });
    expect(await hasActiveGenerationJob(db, idea.id)).toBe(false);

    await seedGenerationJob(db, idea.id, provider.id, { status: "processing" });
    expect(await hasActiveGenerationJob(db, idea.id)).toBe(true);
  });
});
