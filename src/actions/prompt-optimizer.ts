import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { ideas } from "@/db/schema";
import type { ClaudeClient } from "@/lib/claude-client";
import type { ErrorLogStore } from "@/lib/error-log";
import { callWithRetry } from "@/lib/resilient-client";
import { ActionNotFoundError } from "./errors";
import { editIdeaPrompt } from "./ideas";
import { getNiche } from "./niches";
import type { Channel } from "./types";

type Idea = typeof ideas.$inferSelect;

export interface OptimizeIdeaPromptOptions {
  errorLogStore?: ErrorLogStore;
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

function buildOptimizePrompt(idea: Idea, themeGuidance: string, note: string | undefined) {
  const system =
    "You are a prompt engineer for an AI text-to-video generation pipeline. You rewrite " +
    "video generation prompts to be more concrete, visually specific, and likely to produce " +
    "a strong result (camera framing, subject, action, style, lighting, motion). Respond with " +
    "ONLY the rewritten prompt text -- no preamble, no quotes, no markdown, no commentary.";

  const noteLine = note && note.trim().length > 0 ? `\n\nOperator feedback to address: ${note.trim()}` : "";

  const prompt =
    `Niche theme guidance: ${themeGuidance}\n\n` +
    `Video idea: ${idea.title} -- ${idea.concept}\n\n` +
    `Current generation prompt:\n${idea.prompt}${noteLine}\n\n` +
    "Rewrite the generation prompt so it will produce a stronger video. Respond with only the rewritten prompt.";

  return { system, prompt };
}

/**
 * Rewrites a pending idea's generation prompt via Claude -- the "optimise prompt so the
 * new videos will be correct" half of the review-queue ask -- and persists it through the
 * existing editIdeaPrompt action so updatedVia/updatedAt channel tracking stays correct
 * regardless of whether this was triggered from the web review queue or a Telegram card.
 * An optional operator note ("what to fix") is folded into the rewrite instructions.
 */
export async function optimizeIdeaPrompt(
  db: Database,
  ideaId: string,
  claudeClient: ClaudeClient,
  note: string | undefined,
  channel: Channel,
  options: OptimizeIdeaPromptOptions = {},
) {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
  if (!idea) {
    throw new ActionNotFoundError("Idea", ideaId);
  }
  const niche = await getNiche(db, idea.nicheId);

  const { system, prompt } = buildOptimizePrompt(idea, niche.themeGuidance, note);

  const response = await callWithRetry({
    provider: "anthropic",
    operation: "optimizeIdeaPrompt",
    execute: () => claudeClient.complete({ system, prompt, maxTokens: 1024 }),
    errorLogStore: options.errorLogStore,
    payloadSummary: `idea=${ideaId}`,
    maxAttempts: options.maxAttempts,
    baseDelayMs: options.baseDelayMs,
    sleep: options.sleep,
    random: options.random,
  });

  if (response.status !== 200) {
    throw new Error(`Claude request failed with HTTP ${response.status}`);
  }

  const rewritten = response.text.trim();
  if (!rewritten) {
    throw new Error("Claude returned an empty rewritten prompt");
  }

  return editIdeaPrompt(db, ideaId, rewritten, channel);
}
