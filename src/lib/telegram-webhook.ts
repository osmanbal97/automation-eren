import type { Database } from "@/db/client";
import { clearPendingSession, getPendingSession } from "@/actions/bot-sessions";
import { editIdeaCaption, editIdeaPrompt } from "@/actions/ideas";
import type { TelegramClient } from "@/lib/telegram-client";

/** Minimal subset of Telegram's Update object this bot understands. Inline-keyboard
 * callback_query handling (which creates the pending sessions this module resolves)
 * lands in US-014; this only needs the plain-text message shape. */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
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
 * The deferred "slow work" itself: resolves a plain-text reply against whatever the
 * operator's chat currently has pending, applies it through the same shared action
 * layer the web dashboard uses, and confirms via sendMessage.
 *
 * Only idea prompt/caption edits are wired up today, since those are the only
 * multi-step text interactions defined so far (US-014 introduces the inline "Edit
 * Prompt"/"Edit Caption" buttons that create these sessions in the first place; video
 * caption edits follow the same shape once US-015 lands).
 */
export async function processTelegramUpdate(
  db: Database,
  telegram: TelegramClient,
  update: TelegramUpdate,
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
