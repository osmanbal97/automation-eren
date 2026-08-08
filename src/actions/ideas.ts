import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { ideas, videoProviders } from "@/db/schema";
import { estimateCost } from "@/lib/cost-estimator";
import type { GenerationSpecs } from "@/lib/video-providers/types";
import { ActionNotFoundError, InvalidActionStateError } from "./errors";
import type { Channel } from "./types";

async function getIdeaOrThrow(db: Database, ideaId: string) {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
  if (!idea) {
    throw new ActionNotFoundError("Idea", ideaId);
  }
  return idea;
}

function isValidGenerationSpecs(specs: unknown): specs is GenerationSpecs {
  return (
    typeof specs === "object" &&
    specs !== null &&
    typeof (specs as GenerationSpecs).resolution === "string" &&
    typeof (specs as GenerationSpecs).durationSeconds === "number"
  );
}

/** Recomputes estimated_cost (US-008) for a provider/specs pair, or null when either
 * is missing/incomplete -- e.g. a niche-generated idea with no default provider yet, or
 * generation_specs that haven't been filled in on this idea. */
async function recomputeEstimatedCost(
  db: Database,
  providerId: string | null,
  specs: unknown,
): Promise<string | null> {
  if (!providerId || !isValidGenerationSpecs(specs)) {
    return null;
  }
  const [provider] = await db.select().from(videoProviders).where(eq(videoProviders.id, providerId));
  if (!provider) {
    return null;
  }
  return estimateCost(provider, specs).toFixed(4);
}

/** Approves a pending idea, unlocking it for video generation. */
export async function approveIdea(db: Database, ideaId: string, channel: Channel) {
  const idea = await getIdeaOrThrow(db, ideaId);
  if (idea.status !== "pending_review") {
    throw new InvalidActionStateError("Idea", ideaId, ["pending_review"], idea.status);
  }
  const [updated] = await db
    .update(ideas)
    .set({ status: "approved", approvedVia: channel, updatedAt: new Date() })
    .where(eq(ideas.id, ideaId))
    .returning();
  return updated;
}

/** Rejects an idea so it's excluded from generation. */
export async function rejectIdea(db: Database, ideaId: string, channel: Channel) {
  await getIdeaOrThrow(db, ideaId);
  const [updated] = await db
    .update(ideas)
    .set({ status: "rejected", updatedVia: channel, updatedAt: new Date() })
    .where(eq(ideas.id, ideaId))
    .returning();
  return updated;
}

/** Edits the generation prompt on an idea before it's approved. */
export async function editIdeaPrompt(db: Database, ideaId: string, prompt: string, channel: Channel) {
  await getIdeaOrThrow(db, ideaId);
  const [updated] = await db
    .update(ideas)
    .set({ prompt, updatedVia: channel, updatedAt: new Date() })
    .where(eq(ideas.id, ideaId))
    .returning();
  return updated;
}

/** Edits the caption/hashtag copy that will accompany the eventual post. */
export async function editIdeaCaption(db: Database, ideaId: string, caption: string, channel: Channel) {
  await getIdeaOrThrow(db, ideaId);
  const [updated] = await db
    .update(ideas)
    .set({ caption, updatedVia: channel, updatedAt: new Date() })
    .where(eq(ideas.id, ideaId))
    .returning();
  return updated;
}

/** Overrides the niche's default video-generation provider for this one idea, recomputing
 * estimated_cost against the idea's current generation_specs. */
export async function setIdeaProvider(
  db: Database,
  ideaId: string,
  providerId: string,
  channel: Channel,
) {
  const idea = await getIdeaOrThrow(db, ideaId);
  const estimatedCost = await recomputeEstimatedCost(db, providerId, idea.generationSpecs);
  const [updated] = await db
    .update(ideas)
    .set({ providerId, estimatedCost, updatedVia: channel, updatedAt: new Date() })
    .where(eq(ideas.id, ideaId))
    .returning();
  return updated;
}

/** Overrides the niche's default generation specs for this one idea, recomputing
 * estimated_cost against the idea's current provider. */
export async function setIdeaGenerationSpecs(
  db: Database,
  ideaId: string,
  specs: GenerationSpecs,
  channel: Channel,
) {
  const idea = await getIdeaOrThrow(db, ideaId);
  const estimatedCost = await recomputeEstimatedCost(db, idea.providerId, specs);
  const [updated] = await db
    .update(ideas)
    .set({ generationSpecs: specs, estimatedCost, updatedVia: channel, updatedAt: new Date() })
    .where(eq(ideas.id, ideaId))
    .returning();
  return updated;
}
