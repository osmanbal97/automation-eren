"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createNiche, deleteNiche, updateNiche } from "@/actions/niches";
import { getDb } from "@/db/client";

const nicheFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  themeGuidance: z.string().min(1, "Theme guidance is required"),
  tiktokPerDay: z.coerce.number().int().min(0),
  instagramPerDay: z.coerce.number().int().min(0),
  youtubePerDay: z.coerce.number().int().min(0),
  defaultProviderId: z.string().optional().default(""),
  resolution: z.string().min(1, "Resolution is required"),
  durationSeconds: z.coerce.number().positive(),
  aspectRatio: z.string().min(1, "Aspect ratio is required"),
});

function parseNicheForm(formData: FormData) {
  const parsed = nicheFormSchema.parse(Object.fromEntries(formData));
  return {
    name: parsed.name,
    themeGuidance: parsed.themeGuidance,
    targetPostsPerDay: {
      tiktok: parsed.tiktokPerDay,
      instagram: parsed.instagramPerDay,
      youtube: parsed.youtubePerDay,
    },
    defaultProviderId: parsed.defaultProviderId.length > 0 ? parsed.defaultProviderId : null,
    defaultGenerationSpecs: {
      resolution: parsed.resolution,
      durationSeconds: parsed.durationSeconds,
      aspectRatio: parsed.aspectRatio,
    },
  };
}

export async function createNicheAction(formData: FormData) {
  const db = getDb();
  await createNiche(db, parseNicheForm(formData));
  revalidatePath("/niches");
  redirect("/niches");
}

export async function updateNicheAction(nicheId: string, formData: FormData) {
  const db = getDb();
  await updateNiche(db, nicheId, parseNicheForm(formData));
  revalidatePath("/niches");
  revalidatePath(`/niches/${nicheId}`);
  redirect("/niches");
}

export async function deleteNicheAction(nicheId: string) {
  const db = getDb();
  await deleteNiche(db, nicheId);
  revalidatePath("/niches");
  redirect("/niches");
}
