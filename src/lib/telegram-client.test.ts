import { describe, expect, it, vi } from "vitest";
import { createTelegramClient } from "./telegram-client";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("createTelegramClient", () => {
  it("sendMessage posts to the bot's sendMessage endpoint and returns the message id", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { message_id: 42 } }));
    const client = createTelegramClient({ botToken: "test-token", fetchImpl: fetchImpl as unknown as typeof fetch });

    const messageId = await client.sendMessage("123", "hello");

    expect(messageId).toBe(42);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ chat_id: "123", text: "hello" });
  });

  it("editMessageText posts chat_id, message_id, and text", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, { ok: true, result: {} }));
    const client = createTelegramClient({ botToken: "test-token", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.editMessageText("123", 42, "updated text");

    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ chat_id: "123", message_id: 42, text: "updated text" });
  });

  it("throws when Telegram reports ok: false even with an HTTP 200", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: false, description: "chat not found" }));
    const client = createTelegramClient({ botToken: "test-token", fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(client.sendMessage("999", "hi")).rejects.toThrow(/chat not found/);
  });

  it("retries transient 5xx failures and eventually throws once retries are exhausted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { ok: false }));
    const client = createTelegramClient({
      botToken: "test-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(client.sendMessage("123", "hi")).rejects.toThrow(/failed after 4 attempt\(s\)/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
