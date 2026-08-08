"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  approveIdea,
  editIdeaCaption,
  editIdeaPrompt,
  rejectIdea,
  setIdeaGenerationSpecs,
  setIdeaProvider,
} from "@/actions/ideas";
import { optimizeIdeaPrompt } from "@/actions/prompt-optimizer";
import { createAnthropicClaudeClient } from "@/lib/claude-client";
import { createDrizzleErrorLogStore } from "@/lib/error-log";
import { getDb } from "@/db/client";

const updateIdeaFormSchema = z.object({
  ideaId: z.string().uuid(),
  nicheId: z.string().uuid(),
  prompt: z.string().min(1),
  caption: z.string().min(1),
  providerId: z.string().optional().default(""),
  resolution: z.string().min(1),
  durationSeconds: z.coerce.number().positive(),
  aspectRatio: z.string().min(1),
});

/** Saves every editable field on a review-queue card in one submit, each going through
 * its own US-005 action-layer function so approve/reject/edit all share one code path
 * regardless of which channel (web here, Telegram in US-014) triggered them. */
export async function updateIdeaAction(formData: FormData) {
  const { ideaId, nicheId, prompt, caption, providerId, resolution, durationSeconds, aspectRatio } =
    updateIdeaFormSchema.parse(Object.fromEntries(formData));
  const db = getDb();

  await editIdeaPrompt(db, ideaId, prompt, "web");
  await editIdeaCaption(db, ideaId, caption, "web");
  if (providerId.length > 0) {
    await setIdeaProvider(db, ideaId, providerId, "web");
  }
  await setIdeaGenerationSpecs(db, ideaId, { resolution, durationSeconds, aspectRatio }, "web");

  revalidatePath(`/niches/${nicheId}/ideas`);
  revalidatePath(`/niches/${nicheId}`);
}

const ideaIdFormSchema = z.object({
  ideaId: z.string().uuid(),
  nicheId: z.string().uuid(),
});

export async function approveIdeaAction(formData: FormData) {
  const { ideaId, nicheId } = ideaIdFormSchema.parse(Object.fromEntries(formData));
  const db = getDb();
  await approveIdea(db, ideaId, "web");
  revalidatePath(`/niches/${nicheId}/ideas`);
  revalidatePath(`/niches/${nicheId}`);
}

export async function rejectIdeaAction(formData: FormData) {
  const { ideaId, nicheId } = ideaIdFormSchema.parse(Object.fromEntries(formData));
  const db = getDb();
  await rejectIdea(db, ideaId, "web");
  revalidatePath(`/niches/${nicheId}/ideas`);
  revalidatePath(`/niches/${nicheId}`);
}

const optimizePromptFormSchema = z.object({
  ideaId: z.string().uuid(),
  nicheId: z.string().uuid(),
  note: z.string().optional().default(""),
});

/** Rewrites an idea's generation prompt via Claude (US-012 review queue's "optimise
 * prompt" action), folding in an optional operator note on what to fix. */
export async function optimizePromptAction(formData: FormData) {
  const { ideaId, nicheId, note } = optimizePromptFormSchema.parse(Object.fromEntries(formData));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const db = getDb();
  const claudeClient = createAnthropicClaudeClient({ apiKey });
  await optimizeIdeaPrompt(db, ideaId, claudeClient, note, "web", {
    errorLogStore: createDrizzleErrorLogStore(db),
  });
  revalidatePath(`/niches/${nicheId}/ideas`);
  revalidatePath(`/niches/${nicheId}`);
}
