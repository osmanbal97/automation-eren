"use server";

import { revalidatePath } from "next/cache";
import { publishScheduledPost } from "@/actions/publish";
import { getDb } from "@/db/client";
import { createDrizzleErrorLogStore } from "@/lib/error-log";
import { buildPlatformAdapters } from "@/lib/platforms/registry";

/**
 * Manual "retry now" for one scheduled_posts row (US-025), wired straight into the same
 * action layer the cron publish worker uses (US-020's publishScheduledPost via
 * buildPlatformAdapters) so a manual retry behaves identically to an automatic one --
 * same connection-status gate, same publish_jobs bookkeeping, same outcomes. Works
 * regardless of the post's current status: publishScheduledPost doesn't require
 * "scheduled", so this can re-attempt a post the worker already gave up on
 * (status "failed") just as well as one still eligible for its next scheduled tick.
 */
export async function retryPublishAction(scheduledPostId: string) {
  const db = getDb();
  const errorLogStore = createDrizzleErrorLogStore(db);
  const adapters = buildPlatformAdapters(db, { errorLogStore });

  await publishScheduledPost(db, scheduledPostId, adapters, "web");

  revalidatePath("/history");
}
