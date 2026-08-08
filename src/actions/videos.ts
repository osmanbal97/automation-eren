import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { videos } from "@/db/schema";
import { ActionNotFoundError, InvalidActionStateError } from "./errors";
import type { Channel } from "./types";

async function getVideoOrThrow(db: Database, videoId: string) {
  const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) {
    throw new ActionNotFoundError("Video", videoId);
  }
  return video;
}

/** Approves a generated video, making it eligible to be scheduled. */
export async function approveVideo(db: Database, videoId: string, channel: Channel) {
  const video = await getVideoOrThrow(db, videoId);
  if (video.status !== "pending_review") {
    throw new InvalidActionStateError("Video", videoId, ["pending_review"], video.status);
  }
  const [updated] = await db
    .update(videos)
    .set({ status: "ready_to_schedule", approvedVia: channel, updatedAt: new Date() })
    .where(eq(videos.id, videoId))
    .returning();
  return updated;
}

/** Rejects a generated video (e.g. bad render) so it never gets scheduled. */
export async function rejectVideo(db: Database, videoId: string, channel: Channel) {
  await getVideoOrThrow(db, videoId);
  const [updated] = await db
    .update(videos)
    .set({ status: "rejected", updatedVia: channel, updatedAt: new Date() })
    .where(eq(videos.id, videoId))
    .returning();
  return updated;
}

/** Edits the caption/hashtag copy on a generated video before it's posted. */
export async function editVideoCaption(db: Database, videoId: string, caption: string, channel: Channel) {
  await getVideoOrThrow(db, videoId);
  const [updated] = await db
    .update(videos)
    .set({ caption, updatedVia: channel, updatedAt: new Date() })
    .where(eq(videos.id, videoId))
    .returning();
  return updated;
}
