import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { seedBotSession, seedIdea, seedNiche } from "@/actions/test-helpers";
import { botSessions, ideas } from "@/db/schema";
import type { TelegramClient } from "@/lib/telegram-client";
import { handleTelegramWebhook, processTelegramUpdate, type TelegramUpdate } from "./telegram-webhook";

function fakeTelegramClient(): TelegramClient {
  return {
    sendMessage: vi.fn(async () => 1),
    editMessageText: vi.fn(async () => {}),
  };
}

describe("handleTelegramWebhook", () => {
  const update: TelegramUpdate = {
    update_id: 1,
    message: { message_id: 1, chat: { id: 123 }, text: "hi" },
  };

  it("rejects a missing or mismatched secret header without scheduling any work", () => {
    const scheduleAsync = vi.fn();
    const processUpdate = vi.fn();

    const result = handleTelegramWebhook({
      webhookSecret: "correct-secret",
      secretHeader: "wrong-secret",
      update,
      scheduleAsync,
      processUpdate,
    });

    expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(scheduleAsync).not.toHaveBeenCalled();
  });

  it("rejects when TELEGRAM_WEBHOOK_SECRET isn't configured at all", () => {
    const scheduleAsync = vi.fn();

    const result = handleTelegramWebhook({
      webhookSecret: undefined,
      secretHeader: "anything",
      update,
      scheduleAsync,
      processUpdate: vi.fn(),
    });

    expect(result.status).toBe(401);
    expect(scheduleAsync).not.toHaveBeenCalled();
  });

  it("acknowledges immediately without waiting on the slow work behind it", async () => {
    // A deliberately slow, controllable "processUpdate" — resolved only at the end of
    // the test, well after the handler has already returned its result.
    let resolveSlowWork!: () => void;
    const slowWork = new Promise<void>((resolve) => {
      resolveSlowWork = resolve;
    });
    const processUpdate = vi.fn(() => slowWork);

    // Mirrors what Next's `after()` really does: capture the callback to run later,
    // don't invoke or await it during this call.
    let scheduled: (() => Promise<void>) | undefined;
    const scheduleAsync = vi.fn((work: () => Promise<void>) => {
      scheduled = work;
    });

    const result = handleTelegramWebhook({
      webhookSecret: "shh",
      secretHeader: "shh",
      update,
      scheduleAsync,
      processUpdate,
    });

    // The handler already produced its full 200 response — synchronously, with no
    // await needed at all — while the slow work hasn't even started yet.
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(processUpdate).not.toHaveBeenCalled();
    expect(scheduled).toBeDefined();

    // Only now does the deferred work actually run (as `after()` would trigger once
    // the response has gone out), and it's still pending on our controlled promise.
    const inFlight = scheduled!();
    expect(processUpdate).toHaveBeenCalledWith(update);

    resolveSlowWork();
    await inFlight;
  });
});

describe("processTelegramUpdate", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("does nothing for updates without a chat message or text", async () => {
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, { update_id: 1 });

    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("tells the operator there's nothing pending when the chat has no session", async () => {
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      message: { message_id: 1, chat: { id: 999 }, text: "some stray text" },
    });

    expect(telegram.sendMessage).toHaveBeenCalledWith("999", expect.stringContaining("Nothing pending"));
  });

  it("applies a pending prompt edit via the shared action layer and clears the session", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id, { prompt: "old prompt" });
    await seedBotSession(db, "111", {
      pendingAction: "awaiting_text",
      pendingEntityType: "idea",
      pendingEntityId: idea.id,
      pendingField: "prompt",
    });
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      message: { message_id: 2, chat: { id: 111 }, text: "a brand new prompt" },
    });

    const [updatedIdea] = await db.select().from(ideas).where(eq(ideas.id, idea.id));
    const [session] = await db.select().from(botSessions).where(eq(botSessions.chatId, "111"));
    expect(updatedIdea.prompt).toBe("a brand new prompt");
    expect(updatedIdea.updatedVia).toBe("telegram");
    expect(session.pendingAction).toBeNull();
    expect(telegram.sendMessage).toHaveBeenCalledWith("111", expect.stringContaining("Updated"));
  });

  it("applies a pending caption edit the same way", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id, { caption: "old caption" });
    await seedBotSession(db, "222", {
      pendingAction: "awaiting_text",
      pendingEntityType: "idea",
      pendingEntityId: idea.id,
      pendingField: "caption",
    });
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      message: { message_id: 3, chat: { id: 222 }, text: "a brand new caption" },
    });

    const [updatedIdea] = await db.select().from(ideas).where(eq(ideas.id, idea.id));
    expect(updatedIdea.caption).toBe("a brand new caption");
  });

  it("routes a plain-text reply to the correct pending session when multiple chats have one", async () => {
    const niche = await seedNiche(db);
    const ideaA = await seedIdea(db, niche.id, { prompt: "prompt A" });
    const ideaB = await seedIdea(db, niche.id, { caption: "caption B" });
    await seedBotSession(db, "1001", {
      pendingAction: "awaiting_text",
      pendingEntityType: "idea",
      pendingEntityId: ideaA.id,
      pendingField: "prompt",
    });
    await seedBotSession(db, "1002", {
      pendingAction: "awaiting_text",
      pendingEntityType: "idea",
      pendingEntityId: ideaB.id,
      pendingField: "caption",
    });
    const telegram = fakeTelegramClient();

    // Only chat 1001 replies. Chat 1002's session and idea must be left untouched.
    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      message: { message_id: 4, chat: { id: 1001 }, text: "updated prompt A" },
    });

    const [updatedIdeaA] = await db.select().from(ideas).where(eq(ideas.id, ideaA.id));
    const [untouchedIdeaB] = await db.select().from(ideas).where(eq(ideas.id, ideaB.id));
    const [sessionB] = await db.select().from(botSessions).where(eq(botSessions.chatId, "1002"));

    expect(updatedIdeaA.prompt).toBe("updated prompt A");
    expect(untouchedIdeaB.caption).toBe("caption B");
    expect(sessionB.pendingAction).toBe("awaiting_text");
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage).toHaveBeenCalledWith("1001", expect.stringContaining("Updated"));
  });
});
