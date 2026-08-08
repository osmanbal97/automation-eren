import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { platformEnum, publishJobs, scheduledPosts, videos } from "@/db/schema";
import { ActionNotFoundError, InvalidActionStateError } from "./errors";
import type { Channel } from "./types";

export type Platform = (typeof platformEnum.enumValues)[number];

export interface SchedulePostInput {
  videoId: string;
  nicheId: string;
  platform: Platform;
  scheduledAt: Date;
}

/** Schedules an approved video for publishing on one platform at a given time. */
export async function schedulePost(db: Database, input: SchedulePostInput, channel: Channel) {
  const [video] = await db.select().from(videos).where(eq(videos.id, input.videoId));
  if (!video) {
    throw new ActionNotFoundError("Video", input.videoId);
  }
  if (video.status !== "ready_to_schedule") {
    throw new InvalidActionStateError("Video", input.videoId, ["ready_to_schedule"], video.status);
  }

  const [scheduled] = await db
    .insert(scheduledPosts)
    .values({
      videoId: input.videoId,
      nicheId: input.nicheId,
      platform: input.platform,
      scheduledAt: input.scheduledAt,
      status: "scheduled",
      createdVia: channel,
    })
    .returning();
  return scheduled;
}

async function getPublishJobOrThrow(db: Database, publishJobId: string) {
  const [job] = await db.select().from(publishJobs).where(eq(publishJobs.id, publishJobId));
  if (!job) {
    throw new ActionNotFoundError("PublishJob", publishJobId);
  }
  return job;
}

/** Resets a failed publish job back to "pending" so the publish worker picks it up again. */
export async function retryPublish(db: Database, publishJobId: string, channel: Channel) {
  const job = await getPublishJobOrThrow(db, publishJobId);
  if (job.status !== "failed") {
    throw new InvalidActionStateError("PublishJob", publishJobId, ["failed"], job.status);
  }

  const [updated] = await db
    .update(publishJobs)
    .set({ status: "pending", lastError: null, updatedVia: channel, updatedAt: new Date() })
    .where(eq(publishJobs.id, publishJobId))
    .returning();
  return updated;
}
