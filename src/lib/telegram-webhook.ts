import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { clearPendingSession, getPendingSession, setPendingSession } from "@/actions/bot-sessions";
import { approveIdea, editIdeaCaption, editIdeaPrompt, rejectIdea, setIdeaProvider } from "@/actions/ideas";
import { optimizeIdeaPrompt } from "@/actions/prompt-optimizer";
import { approveVideo, editVideoCaption, rejectVideo } from "@/actions/videos";
import { ideas, videoProviders } from "@/db/schema";
import { createAnthropicClaudeClient, type ClaudeClient } from "@/lib/claude-client";
import { createDrizzleErrorLogStore } from "@/lib/error-log";
import type { TelegramClient } from "@/lib/telegram-client";
import { formatIdeaCardText, ideaCardKeyboard, providerPickerKeyboard } from "@/lib/telegram-idea-card";
import { getVideoById } from "@/lib/telegram-video-card";
import type { GenerationSpecs } from "@/lib/video-providers/types";

/** Minimal subset of Telegram's Update object this bot understands: plain-text replies
 * (US-013) and inline-keyboard button taps (US-014, US-015). */
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

/** Injectable dependencies for processTelegramUpdate. Only the "Optimize Prompt" flow
 * needs a Claude client; tests supply a fake one here instead of hitting the real API,
 * and the real webhook route leaves this empty so a client is built from env vars. */
export interface TelegramUpdateDeps {
  claudeClient?: ClaudeClient;
}

function createClaudeClientFromEnv(): ClaudeClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  return createAnthropicClaudeClient({ apiKey });
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
  deps: TelegramUpdateDeps = {},
): Promise<void> {
  if (update.callback_query) {
    await processCallbackQuery(db, telegram, update.callback_query);
    return;
  }
  await processTextMessage(db, telegram, update, deps);
}

/**
 * Resolves a plain-text reply against whatever the operator's chat currently has
 * pending (set by the "Edit Prompt"/"Edit Caption"/"Optimize Prompt" buttons below),
 * applies it through the same shared action layer the web dashboard uses, and confirms
 * via sendMessage.
 */
async function processTextMessage(
  db: Database,
  telegram: TelegramClient,
  update: TelegramUpdate,
  deps: TelegramUpdateDeps,
): Promise<void> {
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

  if (session.pendingEntityType === "idea" && session.pendingEntityId && session.pendingField === "optimize_note") {
    await handleOptimizeNoteReply(db, telegram, chatIdStr, session.pendingEntityId, text, deps);
    return;
  }

  if (session.pendingEntityType === "idea" && session.pendingEntityId) {
    if (session.pendingField === "prompt") {
      await editIdeaPrompt(db, session.pendingEntityId, text, "telegram");
    } else if (session.pendingField === "caption") {
      await editIdeaCaption(db, session.pendingEntityId, text, "telegram");
    }
  } else if (session.pendingEntityType === "video" && session.pendingEntityId && session.pendingField === "caption") {
    await editVideoCaption(db, session.pendingEntityId, text, "telegram");
  }

  await clearPendingSession(db, chatIdStr);
  await telegram.sendMessage(chatIdStr, "Updated ✅");
}

/**
 * Completes the "Optimize Prompt" flow (US-012/US-014's prompt-optimizer): the
 * operator's reply is either a note on what to fix, or "-" to optimize as-is. Claude
 * failures (including a missing ANTHROPIC_API_KEY) are reported back to the chat
 * instead of silently swallowed, since this is the one text-reply flow that calls out
 * to an external API.
 */
async function handleOptimizeNoteReply(
  db: Database,
  telegram: TelegramClient,
  chatIdStr: string,
  ideaId: string,
  text: string,
  deps: TelegramUpdateDeps,
): Promise<void> {
  await clearPendingSession(db, chatIdStr);
  const note = text.trim() === "-" ? "" : text;
  try {
    const claudeClient = deps.claudeClient ?? createClaudeClientFromEnv();
    await optimizeIdeaPrompt(db, ideaId, claudeClient, note, "telegram", {
      errorLogStore: createDrizzleErrorLogStore(db),
    });
  } catch (error) {
    await telegram.sendMessage(chatIdStr, `Couldn't optimize that prompt: ${(error as Error).message}`);
    return;
  }
  const found = await getIdeaWithProvider(db, ideaId);
  if (!found) {
    return;
  }
  await telegram.sendMessage(chatIdStr, `✨ Prompt rewritten\n\n${formatIdeaCardText(found.idea, found.provider)}`, {
    replyMarkup: ideaCardKeyboard(found.idea.id),
  });
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
 * Handles a tap on one of a card's inline buttons: idea cards (US-014) or video
 * cards (US-015). Both dispatch to the exact same US-005 action-layer functions the
 * web review queues use; the video namespace is the smaller of the two since videos
 * only ever get Approve/Reject/Edit Caption (no provider to change post-generation).
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
  if (!namespace || !action || !id) {
    return;
  }

  if (namespace === "video") {
    await processVideoCallback(db, telegram, chatIdStr, messageId, action, id);
    return;
  }
  if (namespace !== "idea") {
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

  if (action === "optimize") {
    await setPendingSession(db, chatIdStr, {
      pendingAction: "awaiting_text",
      pendingEntityType: "idea",
      pendingEntityId: id,
      pendingField: "optimize_note",
    });
    await telegram.sendMessage(chatIdStr, "What should Claude fix? Send a short note, or send - to optimize as-is.");
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

/**
 * Handles a tap on a video card's inline buttons (US-015). Approve/Reject call the
 * same US-005 action-layer functions the web video review queue uses; the keyboard is
 * cleared via editMessageReplyMarkup rather than editMessageText, since the card may be
 * a video or photo message (editMessageText only works on plain text messages). Edit
 * Caption opens the same awaiting-text pending session used by idea cards.
 */
async function processVideoCallback(
  db: Database,
  telegram: TelegramClient,
  chatIdStr: string,
  messageId: number,
  action: string,
  videoId: string,
): Promise<void> {
  if (action === "approve" || action === "reject") {
    try {
      const updated =
        action === "approve" ? await approveVideo(db, videoId, "telegram") : await rejectVideo(db, videoId, "telegram");
      const label = action === "approve" ? "✅ Approved" : "❌ Rejected";
      await telegram.editMessageReplyMarkup(chatIdStr, messageId, { inline_keyboard: [] });
      await telegram.sendMessage(chatIdStr, `${label}\n\n${updated?.caption ?? "Video"}`);
    } catch (error) {
      await telegram.sendMessage(chatIdStr, `Couldn't do that: ${(error as Error).message}`);
    }
    return;
  }

  if (action === "editcaption") {
    const video = await getVideoById(db, videoId);
    if (!video) {
      return;
    }
    await setPendingSession(db, chatIdStr, {
      pendingAction: "awaiting_text",
      pendingEntityType: "video",
      pendingEntityId: videoId,
      pendingField: "caption",
    });
    await telegram.sendMessage(chatIdStr, "Send me the replacement caption.");
  }
}
