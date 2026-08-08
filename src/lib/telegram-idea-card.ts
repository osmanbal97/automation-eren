import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { ideas, videoProviders } from "@/db/schema";
import { createDrizzleErrorLogStore } from "@/lib/error-log";
import { estimateCost } from "@/lib/cost-estimator";
import type { GenerationSpecs } from "@/lib/video-providers/types";
import { createTelegramClient, type InlineKeyboardMarkup, type TelegramClient } from "@/lib/telegram-client";

type Idea = typeof ideas.$inferSelect;
type Provider = typeof videoProviders.$inferSelect;

/** Renders the operator-facing text for one idea, mirroring the fields shown on the
 * web review queue (US-012): title, concept, prompt, and provider name + estimated
 * cost when a provider is set. */
export function formatIdeaCardText(idea: Idea, provider: Provider | null): string {
  const providerLine = provider
    ? `Provider: ${provider.name} (~$${idea.estimatedCost ?? "?"})`
    : "Provider: none picked yet";

  return [
    `💡 ${idea.title}`,
    "",
    idea.concept,
    "",
    `Prompt: ${idea.prompt}`,
    `Caption: ${idea.caption}`,
    providerLine,
  ].join("\n");
}

/** The Approve/Reject/Edit/Change-Provider keyboard shown on every pending idea card.
 * Callback data stays under Telegram's 64-byte limit by carrying only the idea id --
 * the "Change Provider" flow's second step (picking one) instead resolves which idea
 * it's for via the chat's pending bot_sessions row (see telegram-webhook.ts). */
export function ideaCardKeyboard(ideaId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `idea:approve:${ideaId}` },
        { text: "❌ Reject", callback_data: `idea:reject:${ideaId}` },
      ],
      [
        { text: "✏️ Edit Prompt", callback_data: `idea:editprompt:${ideaId}` },
        { text: "✏️ Edit Caption", callback_data: `idea:editcaption:${ideaId}` },
      ],
      [{ text: "🔁 Change Provider", callback_data: `idea:changeprovider:${ideaId}` }],
    ],
  };
}

/** One button per enabled provider, labeled with its price for this idea's current
 * generation specs. Carries only the provider id in callback_data -- which idea it
 * applies to comes from the pending bot_sessions row set right before this is sent. */
export function providerPickerKeyboard(providers: Provider[], specs: GenerationSpecs): InlineKeyboardMarkup {
  return {
    inline_keyboard: providers.map((provider) => [
      {
        text: `${provider.name} — $${estimateCost(provider, specs).toFixed(4)}`,
        callback_data: `idea:setprovider:${provider.id}`,
      },
    ]),
  };
}

/** Pushes a brand-new pending idea to the operator's chat as a card with action
 * buttons (US-014). Returns the sent message id in case a caller wants to edit it later. */
export async function sendIdeaCard(
  telegram: TelegramClient,
  chatId: string,
  idea: Idea,
  provider: Provider | null,
): Promise<number> {
  return telegram.sendMessage(chatId, formatIdeaCardText(idea, provider), {
    replyMarkup: ideaCardKeyboard(idea.id),
  });
}

/**
 * Pushes every freshly-generated idea to the operator's Telegram chat (US-014's first
 * acceptance criterion). A no-op when Telegram isn't configured yet (TELEGRAM_BOT_TOKEN
 * / TELEGRAM_OPERATOR_CHAT_ID), and failures here are swallowed per-idea so a Telegram
 * outage never breaks idea generation itself -- the ideas still land in the web review
 * queue either way.
 */
export async function notifyPendingIdeas(db: Database, createdIdeas: Idea[]): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID;
  if (!botToken || !chatId || createdIdeas.length === 0) {
    return;
  }
  const telegram = createTelegramClient({ botToken, errorLogStore: createDrizzleErrorLogStore(db) });
  for (const idea of createdIdeas) {
    const provider = idea.providerId
      ? (await db.select().from(videoProviders).where(eq(videoProviders.id, idea.providerId)))[0]
      : undefined;
    try {
      await sendIdeaCard(telegram, chatId, idea, provider ?? null);
    } catch (error) {
      console.error("Failed to push idea card to Telegram", error);
    }
  }
}
