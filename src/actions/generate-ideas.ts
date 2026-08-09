import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/client";
import { ideas, videoProviders } from "@/db/schema";
import type { ClaudeClient } from "@/lib/claude-client";
import { estimateCost } from "@/lib/cost-estimator";
import type { ErrorLogStore } from "@/lib/error-log";
import { callWithRetry } from "@/lib/resilient-client";
import type { GenerationSpecs } from "@/lib/video-providers/types";
import { getNiche } from "./niches";

const generatedIdeaSchema = z.object({
  title: z.string().min(1),
  concept: z.string().min(1),
  prompt: z.string().min(1),
  caption: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
});

const generatedIdeasResponseSchema = z.array(generatedIdeaSchema).min(1);

export interface GenerateIdeasOptions {
  errorLogStore?: ErrorLogStore;
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

function buildPrompt(
  themeGuidance: string,
  count: number,
  referenceGuidance?: string | null,
): { system: string; prompt: string } {
  const system =
    "You are a creative director for a short-form AI video content channel. You generate " +
    "concrete, production-ready video concepts, not vague ideas. Respond with ONLY a JSON " +
    "array (no markdown code fences, no commentary) of objects shaped exactly like: " +
    '{"title": string, "concept": string, "prompt": string, "caption": string, "hashtags": string[]}. ' +
    '"prompt" must be a detailed, literal text-to-video generation prompt suitable for an AI ' +
    'video model (camera framing, subject, action, style, lighting). "caption" is the social ' +
    'media post caption. "hashtags" are plain words/phrases without the leading "#".';

  // Reference guidance (US-027) gets its own clearly labelled section rather than being
  // folded into theme guidance, so Claude treats it as "emulate this specific reference"
  // rather than "another fact about the niche". When absent, the prompt is byte-identical
  // to before this field existed -- see the regression test pinning that.
  const referenceSection =
    referenceGuidance && referenceGuidance.trim().length > 0
      ? "\n\nReference video style guidance (the operator described a specific reference " +
        "video -- either in their own words, or via a description another AI wrote after " +
        "watching it -- match the ideas' look, mood and subject to this reference, not just " +
        `the theme below):\n${referenceGuidance}`
      : "";

  const prompt =
    `Generate exactly ${count} distinct short-form video ideas for this niche:\n\n` +
    `${themeGuidance}${referenceSection}\n\n` +
    "Respond with only the JSON array.";

  return { system, prompt };
}

function parseIdeasResponse(text: string) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Claude response was not valid JSON: ${text.slice(0, 200)}`);
  }
  return generatedIdeasResponseSchema.parse(json);
}

/**
 * Generates fresh video ideas for a niche via Claude, inheriting the niche's
 * default provider + default generation specs and computing estimated_cost
 * (US-008) for each, then saves them all with status "pending_review".
 */
export async function generateIdeas(
  db: Database,
  nicheId: string,
  claudeClient: ClaudeClient,
  count = 5,
  options: GenerateIdeasOptions = {},
) {
  const niche = await getNiche(db, nicheId);

  const provider = niche.defaultProviderId
    ? (await db.select().from(videoProviders).where(eq(videoProviders.id, niche.defaultProviderId)))[0]
    : undefined;

  const specs = niche.defaultGenerationSpecs as GenerationSpecs;
  const estimatedCost = provider ? estimateCost(provider, specs) : undefined;

  const { system, prompt } = buildPrompt(niche.themeGuidance, count, niche.referenceGuidance);

  const response = await callWithRetry({
    provider: "anthropic",
    operation: "generateIdeas",
    execute: () => claudeClient.complete({ system, prompt, maxTokens: 4096 }),
    errorLogStore: options.errorLogStore,
    payloadSummary: `niche=${nicheId} count=${count}`,
    maxAttempts: options.maxAttempts,
    baseDelayMs: options.baseDelayMs,
    sleep: options.sleep,
    random: options.random,
  });

  if (response.status !== 200) {
    throw new Error(`Claude request failed with HTTP ${response.status}`);
  }

  const generated = parseIdeasResponse(response.text);

  const rows = await db
    .insert(ideas)
    .values(
      generated.map((idea) => ({
        nicheId,
        title: idea.title,
        concept: idea.concept,
        prompt: idea.prompt,
        caption: idea.caption,
        hashtags: idea.hashtags,
        providerId: niche.defaultProviderId,
        generationSpecs: specs,
        estimatedCost: estimatedCost !== undefined ? estimatedCost.toFixed(4) : null,
        status: "pending_review" as const,
      })),
    )
    .returning();

  return rows;
}
