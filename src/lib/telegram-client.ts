import type { ErrorLogStore } from "@/lib/error-log";
import { callWithRetry } from "@/lib/resilient-client";

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramSendOptions {
  replyMarkup?: InlineKeyboardMarkup;
}

/** Thin wrapper around the Telegram Bot API's sendMessage/editMessageText methods,
 * used for the async follow-up half of the fast-ack pattern (US-013): the webhook
 * handler acks immediately, then this is used to deliver the real result once the
 * slow work behind it finishes. Also used (US-014) to render idea cards with inline
 * keyboards and to acknowledge button taps. */
export interface TelegramClient {
  /** Returns the sent message's message_id, so a later step can editMessageText it. */
  sendMessage(chatId: string, text: string, options?: TelegramSendOptions): Promise<number>;
  editMessageText(chatId: string, messageId: number, text: string, options?: TelegramSendOptions): Promise<void>;
  /** Stops the loading spinner Telegram shows on a tapped inline button. */
  answerCallbackQuery(callbackQueryId: string): Promise<void>;
}

export interface TelegramClientOptions {
  botToken: string;
  baseUrl?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  errorLogStore?: ErrorLogStore;
  /** Retry tuning, passed straight through to callWithRetry — mainly for fast, deterministic tests. */
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export function createTelegramClient(options: TelegramClientOptions): TelegramClient {
  const baseUrl = options.baseUrl ?? "https://api.telegram.org";
  const fetchImpl = options.fetchImpl ?? fetch;

  async function callMethod<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await callWithRetry({
      provider: "telegram",
      operation: method,
      execute: () =>
        fetchImpl(`${baseUrl}/bot${options.botToken}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      errorLogStore: options.errorLogStore,
      payloadSummary: method,
      maxAttempts: options.maxAttempts,
      baseDelayMs: options.baseDelayMs,
      sleep: options.sleep,
      random: options.random,
    });

    const payload = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !payload.ok) {
      throw new Error(`Telegram ${method} failed: HTTP ${response.status} ${payload.description ?? ""}`.trim());
    }
    return payload.result as T;
  }

  return {
    async sendMessage(chatId, text, options) {
      const result = await callMethod<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text,
        ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      });
      return result.message_id;
    },
    async editMessageText(chatId, messageId, text, options) {
      await callMethod("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      });
    },
    async answerCallbackQuery(callbackQueryId) {
      await callMethod("answerCallbackQuery", { callback_query_id: callbackQueryId });
    },
  };
}
