import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { clearPendingSession, getPendingSession, setPendingSession } from "@/actions/bot-sessions";
import { approveIdea, editIdeaCaption, editIdeaPrompt, rejectIdea, setIdeaProvider } from "@/actions/ideas";
import { ideas, videoProviders } from "@/db/schema";
import type { TelegramClient } from "@/lib/telegram-client";
import { formatIdeaCardText, ideaCardKeyboard, providerPickerKeyboard } from "@/lib/telegram-idea-card";
import type { GenerationSpecs } from "@/lib/video-providers/types";

/** Minimal subset of Telegram's Update object this bot understands: plain-text replies
 * (US-013) and inline-keyboard button taps (US-014). */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      message_id: number;
      chat: { id: number };
    };
  };
}

export interface HandleTelegramWebhookParams {
  webhookSecret: string | undefined;
  secretHeader: string | null;
  update: TelegramUpdate;
  /** Schedules `work` to run after the response has been sent, without this function
   * waiting on it — the real route passes Next's `after()`; tests pass a controllable
   * stub, since `after()` throws when called outside an actual request scope. */
  scheduleAsync: (work: () => Promise<void>) => void;
  processUpdate: (update: TelegramUpdate) => Promise<void>;
}

export interface HandleTelegramWebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Synchronous by design (US-013's fast-ack pattern): verifies the secret header, then
 * -- if the request is authentic -- schedules the real work via `scheduleAsync` and
 * returns immediately. It never awaits `processUpdate`, so the caller (the webhook
 * route) can respond with a 200 well under Telegram's timeout regardless of how slow
 * the deferred work turns out to be.
 */
export function handleTelegramWebhook(params: HandleTelegramWebhookParams): HandleTelegramWebhookResult {
  const { webhookSecret, secretHeader, update, scheduleAsync, processUpdate } = params;

  if (!webhookSecret || secretHeader !== webhookSecret) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  scheduleAsync(() => processUpdate(update));
  return { status: 200, body: { ok: true } };
}

/**
 * The deferred "slow work" itself: routes a message-shaped update to the plain-text
 * handler and a callback_query-shaped update to the button-tap handler.
 */
export async function processTelegramUpdate(
  db: Database,
  telegram: TelegramClient,
  update: TelegramUpdate,
): Promise<void> {
  if (update.callback_query) {
    await processCallbackQuery(db, telegram, update.callback_query);
    return;
  }
  await processTextMessage(db, telegram, update);
}

/**
 * Resolves a plain-text reply against whatever the operator's chat currently has
 * pending (set by the "Edit Prompt"/"Edit Caption" buttons below), applies it through
 * the same shared action layer the web dashboard uses, and confirms via sendMessage.
 */
async function processTextMessage(db: Database, telegram: TelegramClient, update: TelegramUpdate): Promise<void> {
  const chatId = update.message?.chat.id;
  const text = update.message?.text;
  if (chatId === undefined || !text) {
    return;
  }
  const chatIdStr = String(chatId);

  const session = await getPendingSession(db, chatIdStr);
  if (!session) {
    await telegram.sendMessage(chatIdStr, "Nothing pending right now — use a card's buttons to start editing something.");
    return;
  }

  if (session.pendingEntityType === "idea" && session.pendingEntityId) {
    if (session.pendingField === "prompt") {
      await editIdeaPrompt(db, session.pendingEntityId, text, "telegram");
    } else if (session.pendingField === "caption") {
      await editIdeaCaption(db, session.pendingEntityId, text, "telegram");
    }
  }

  await clearPendingSession(db, chatIdStr);
  await telegram.sendMessage(chatIdStr, "Updated ✅");
}

async function getIdeaWithProvider(db: Database, ideaId: string) {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
  if (!idea) {
    return null;
  }
  const provider = idea.providerId
    ? (await db.select().from(videoProviders).where(eq(videoProviders.id, idea.providerId)))[0]
    : null;
  return { idea, provider: provider ?? null };
}

/**
 * Handles a tap on one of the idea card's inline buttons (US-014): Approve/Reject
 * call the exact same US-005 action-layer functions the web review queue uses;
 * Edit Prompt/Edit Caption open a pending bot_sessions text prompt (resolved by
 * processTextMessage above); Change Provider opens a second inline keyboard of
 * enabled providers, and picking one (setprovider) resolves which idea it's for via
 * that same pending session rather than the callback_data, to stay under Telegram's
 * 64-byte callback_data limit.
 */
async function processCallbackQuery(
  db: Database,
  telegram: TelegramClient,
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const chatId = callbackQuery.message?.chat.id;
  const messageId = callbackQuery.message?.message_id;
  const data = callbackQuery.data;
  await telegram.answerCallbackQuery(callbackQuery.id);
  if (chatId === undefined || messageId === undefined || !data) {
    return;
  }
  const chatIdStr = String(chatId);
  const [namespace, action, id] = data.split(":");
  if (namespace !== "idea" || !action || !id) {
    return;
  }

  if (action === "approve" || action === "reject") {
    try {
      const updated = action === "approve" ? await approveIdea(db, id, "telegram") : await rejectIdea(db, id, "telegram");
      const label = action === "approve" ? "✅ Approved" : "❌ Rejected";
      await telegram.editMessageText(chatIdStr, messageId, `${label}\n\n${updated.title}`, {
        replyMarkup: { inline_keyboard: [] },
      });
    } catch (error) {
      await telegram.sendMessage(chatIdStr, `Couldn't do that: ${(error as Error).message}`);
    }
    return;
  }

  if (action === "editprompt" || action === "editcaption") {
    await setPendingSession(db, chatIdStr, {
      pendingAction: "awaiting_text",
      pendingEntityType: "idea",
      pendingEntityId: id,
      pendingField: action === "editprompt" ? "prompt" : "caption",
    });
    await telegram.sendMessage(
      chatIdStr,
      action === "editprompt" ? "Send me the replacement prompt." : "Send me the replacement caption.",
    );
    return;
  }

  if (action === "changeprovider") {
    const found = await getIdeaWithProvider(db, id);
    if (!found) {
      return;
    }
    const providers = await db.select().from(videoProviders).where(eq(videoProviders.enabled, true));
    await setPendingSession(db, chatIdStr, {
      pendingAction: "choosing_provider",
      pendingEntityType: "idea",
      pendingEntityId: id,
      pendingField: null,
    });
    await telegram.sendMessage(chatIdStr, "Pick a provider:", {
      replyMarkup: providerPickerKeyboard(providers, found.idea.generationSpecs as GenerationSpecs),
    });
    return;
  }

  if (action === "setprovider") {
    const session = await getPendingSession(db, chatIdStr);
    if (!session || session.pendingAction !== "choosing_provider" || !session.pendingEntityId) {
      await telegram.sendMessage(chatIdStr, "That provider picker expired — tap Change Provider again.");
      return;
    }
    await setIdeaProvider(db, session.pendingEntityId, id, "telegram");
    await clearPendingSession(db, chatIdStr);
    const found = await getIdeaWithProvider(db, session.pendingEntityId);
    if (!found) {
      return;
    }
    await telegram.sendMessage(chatIdStr, formatIdeaCardText(found.idea, found.provider), {
      replyMarkup: ideaCardKeyboard(found.idea.id),
    });
  }
}
