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
