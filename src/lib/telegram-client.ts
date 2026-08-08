import type { ErrorLogStore } from "@/lib/error-log";
import { callWithRetry } from "@/lib/resilient-client";

/** Thin wrapper around the Telegram Bot API's sendMessage/editMessageText methods,
 * used for the async follow-up half of the fast-ack pattern (US-013): the webhook
 * handler acks immediately, then this is used to deliver the real result once the
 * slow work behind it finishes. */
export interface TelegramClient {
  /** Returns the sent message's message_id, so a later step can editMessageText it. */
  sendMessage(chatId: string, text: string): Promise<number>;
  editMessageText(chatId: string, messageId: number, text: string): Promise<void>;
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
    async sendMessage(chatId, text) {
      const result = await callMethod<{ message_id: number }>("sendMessage", { chat_id: chatId, text });
      return result.message_id;
    },
    async editMessageText(chatId, messageId, text) {
      await callMethod("editMessageText", { chat_id: chatId, message_id: messageId, text });
    },
  };
}
