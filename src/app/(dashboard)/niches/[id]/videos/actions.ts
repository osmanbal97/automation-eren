"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { regenerateVideo } from "@/actions/generation-jobs";
import { editIdeaPrompt } from "@/actions/ideas";
import { optimizeIdeaPrompt } from "@/actions/prompt-optimizer";
import { approveVideo, editVideoCaption, editVideoHashtags, rejectVideo } from "@/actions/videos";
import { createAnthropicClaudeClient } from "@/lib/claude-client";
import { createDrizzleErrorLogStore } from "@/lib/error-log";
import { getDb } from "@/db/client";

const videoIdFormSchema = z.object({
  videoId: z.string().uuid(),
  nicheId: z.string().uuid(),
});

/** Approves a generated video, making it eligible for scheduling (US-018). */
export async function approveVideoAction(formData: FormData) {
  const { videoId, nicheId } = videoIdFormSchema.parse(Object.fromEntries(formData));
  const db = getDb();
  await approveVideo(db, videoId, "web");
  revalidatePath(`/niches/${nicheId}/videos`);
  revalidatePath(`/niches/${nicheId}`);
}

export async function rejectVideoAction(formData: FormData) {
  const { videoId, nicheId } = videoIdFormSchema.parse(Object.fromEntries(formData));
  const db = getDb();
  await rejectVideo(db, videoId, "web");
  revalidatePath(`/niches/${nicheId}/videos`);
  revalidatePath(`/niches/${nicheId}`);
}

const updateVideoFormSchema = z.object({
  videoId: z.string().uuid(),
  nicheId: z.string().uuid(),
  caption: z.string().min(1),
  hashtags: z.string().optional().default(""),
});

/** Saves the caption/hashtag copy shown on the review card in one submit. The schema
 * only carries one caption/hashtag set per video (no per-platform variants exist yet),
 * so this is what gets posted to every connected platform. */
export async function updateVideoAction(formData: FormData) {
  const { videoId, nicheId, caption, hashtags } = updateVideoFormSchema.parse(Object.fromEntries(formData));
  const db = getDb();
  await editVideoCaption(db, videoId, caption, "web");
  const tags = hashtags
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  await editVideoHashtags(db, videoId, tags, "web");
  revalidatePath(`/niches/${nicheId}/videos`);
}

const regenerateWithPromptFormSchema = z.object({
  ideaId: z.string().uuid(),
  nicheId: z.string().uuid(),
  prompt: z.string().min(1),
});

/** Regenerate, edit-prompt path (US-018): saves the operator's replacement prompt on
 * the underlying idea, then queues a fresh generation job for it. The old video stays
 * in place as history until the new job completes and produces its own row. */
export async function regenerateWithEditedPromptAction(formData: FormData) {
  const { ideaId, nicheId, prompt } = regenerateWithPromptFormSchema.parse(Object.fromEntries(formData));
  const db = getDb();
  await editIdeaPrompt(db, ideaId, prompt, "web");
  await regenerateVideo(db, ideaId, "web", { errorLogStore: createDrizzleErrorLogStore(db) });
  revalidatePath(`/niches/${nicheId}/videos`);
  revalidatePath(`/niches/${nicheId}`);
}

const regenerateWithOptimizedPromptFormSchema = z.object({
  ideaId: z.string().uuid(),
  nicheId: z.string().uuid(),
  note: z.string().optional().default(""),
});

/** Regenerate, optimize-prompt path (US-018): rewrites the underlying idea's prompt
 * via Claude (optionally steered by an operator note), then queues a fresh generation
 * job for it. */
export async function regenerateWithOptimizedPromptAction(formData: FormData) {
  const { ideaId, nicheId, note } = regenerateWithOptimizedPromptFormSchema.parse(Object.fromEntries(formData));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const db = getDb();
  const claudeClient = createAnthropicClaudeClient({ apiKey });
  await optimizeIdeaPrompt(db, ideaId, claudeClient, note, "web", {
    errorLogStore: createDrizzleErrorLogStore(db),
  });
  await regenerateVideo(db, ideaId, "web", { errorLogStore: createDrizzleErrorLogStore(db) });
  revalidatePath(`/niches/${nicheId}/videos`);
  revalidatePath(`/niches/${nicheId}`);
}
