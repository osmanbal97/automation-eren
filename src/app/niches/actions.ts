"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { generateIdeas } from "@/actions/generate-ideas";
import { createNiche, deleteNiche, updateNiche } from "@/actions/niches";
import { setConnectionStatus } from "@/actions/platform-connections";
import { createAnthropicClaudeClient } from "@/lib/claude-client";
import { getDb } from "@/db/client";
import { createDrizzleErrorLogStore } from "@/lib/error-log";

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

const connectionStatusFormSchema = z.object({
  nicheId: z.string().uuid(),
  platform: z.enum(["tiktok", "instagram", "youtube"]),
  status: z.enum(["disconnected", "pending_review", "active"]),
});

export async function updateConnectionStatusAction(formData: FormData) {
  const { nicheId, platform, status } = connectionStatusFormSchema.parse(Object.fromEntries(formData));
  const db = getDb();
  await setConnectionStatus(db, nicheId, platform, status);
  revalidatePath(`/niches/${nicheId}`);
  revalidatePath("/niches");
}

/** Generates 5 fresh ideas for a niche via Claude. Ideas land as pending_review;
 * reviewing/approving/rejecting them is US-012's job, not this action's. */
export async function generateIdeasAction(nicheId: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const db = getDb();
  const claudeClient = createAnthropicClaudeClient({ apiKey });
  await generateIdeas(db, nicheId, claudeClient, 5, { errorLogStore: createDrizzleErrorLogStore(db) });
  revalidatePath(`/niches/${nicheId}`);
}
