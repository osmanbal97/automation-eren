import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { botSessions } from "@/db/schema";

/** Shape of a chat's pending multi-step interaction, e.g. "awaiting new prompt text
 * for idea #42" (set right before the bot asks a follow-up question, cleared once the
 * operator's next plain-text reply has been applied). */
export interface PendingSession {
  pendingAction: string | null;
  pendingEntityType: string | null;
  pendingEntityId: string | null;
  pendingField: string | null;
}

/** Looks up the operator's pending interaction for a chat. Returns null both when the
 * chat has no session row yet and when its row has nothing pending — callers only care
 * about "is there something to route this text to," not which case produced that. */
export async function getPendingSession(db: Database, chatId: string): Promise<PendingSession | null> {
  const [session] = await db.select().from(botSessions).where(eq(botSessions.chatId, chatId));
  if (!session || !session.pendingAction) {
    return null;
  }
  return {
    pendingAction: session.pendingAction,
    pendingEntityType: session.pendingEntityType,
    pendingEntityId: session.pendingEntityId,
    pendingField: session.pendingField,
  };
}

/** Records a pending interaction for a chat, upserting since each chat has at most one
 * bot_sessions row (chat_id is unique). */
export async function setPendingSession(db: Database, chatId: string, session: PendingSession): Promise<void> {
  await db
    .insert(botSessions)
    .values({ chatId, ...session, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: botSessions.chatId,
      set: { ...session, updatedAt: new Date() },
    });
}

/** Clears a chat's pending interaction once it's been resolved or cancelled. */
export async function clearPendingSession(db: Database, chatId: string): Promise<void> {
  await setPendingSession(db, chatId, {
    pendingAction: null,
    pendingEntityType: null,
    pendingEntityId: null,
    pendingField: null,
  });
}
