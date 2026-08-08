import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { ideas } from "@/db/schema";
import { ActionNotFoundError, InvalidActionStateError } from "./errors";
import type { Channel } from "./types";

async function getIdeaOrThrow(db: Database, ideaId: string) {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
  if (!idea) {
    throw new ActionNotFoundError("Idea", ideaId);
  }
  return idea;
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

/** Overrides the niche's default video-generation provider for this one idea. */
export async function setIdeaProvider(
  db: Database,
  ideaId: string,
  providerId: string,
  channel: Channel,
) {
  await getIdeaOrThrow(db, ideaId);
  const [updated] = await db
    .update(ideas)
    .set({ providerId, updatedVia: channel, updatedAt: new Date() })
    .where(eq(ideas.id, ideaId))
    .returning();
  return updated;
}
