"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schedulePost, type Platform } from "@/actions/scheduling";
import { getDb } from "@/db/client";

const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;

const scheduleFormSchema = z.object({
  videoId: z.string().uuid(),
  nicheId: z.string().uuid(),
  scheduledAt: z.string().min(1),
  platforms: z.array(z.enum(PLATFORMS)).min(1, "Select at least one platform"),
});

/** Books a ready_to_schedule video onto one or more platforms at one datetime (US-019).
 * The `scheduledAt` value comes from a native datetime-local input (no timezone suffix),
 * so `new Date(...)` parses it in the server's local time zone -- fine for a
 * single-operator tool with one deployment region. Cap enforcement lives in the
 * schedulePost action itself; a cap-exceeded or invalid-state error here propagates as
 * an unhandled action error, same as every other mutating action in this app. */
export async function scheduleVideoAction(formData: FormData) {
  const { videoId, nicheId, scheduledAt, platforms } = scheduleFormSchema.parse({
    videoId: formData.get("videoId"),
    nicheId: formData.get("nicheId"),
    scheduledAt: formData.get("scheduledAt"),
    platforms: formData.getAll("platforms"),
  });
  const db = getDb();
  await schedulePost(db, videoId, platforms as Platform[], new Date(scheduledAt), "web");
  revalidatePath(`/niches/${nicheId}/schedule`);
  revalidatePath(`/niches/${nicheId}`);
}
