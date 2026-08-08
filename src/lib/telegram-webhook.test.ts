import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { getPendingSession } from "@/actions/bot-sessions";
import { seedBotSession, seedGenerationJob, seedIdea, seedNiche, seedProvider, seedVideo } from "@/actions/test-helpers";
import { botSessions, ideas, videos } from "@/db/schema";
import type { TelegramClient } from "@/lib/telegram-client";
import { handleTelegramWebhook, processTelegramUpdate, type TelegramUpdate } from "./telegram-webhook";

function fakeTelegramClient(): TelegramClient {
  return {
    sendMessage: vi.fn(async () => 1),
    editMessageText: vi.fn(async () => {}),
    sendVideo: vi.fn(async () => 1),
    sendPhoto: vi.fn(async () => 1),
    editMessageCaption: vi.fn(async () => {}),
    editMessageReplyMarkup: vi.fn(async () => {}),
    answerCallbackQuery: vi.fn(async () => {}),
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

describe("processTelegramUpdate — callback_query (idea cards, US-014)", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("approve calls the shared action layer, acks the tap, and removes the keyboard", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id, { title: "Tunnel ride" });
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      callback_query: { id: "cbq-1", data: `idea:approve:${idea.id}`, message: { message_id: 5, chat: { id: 42 } } },
    });

    const [updated] = await db.select().from(ideas).where(eq(ideas.id, idea.id));
    expect(updated.status).toBe("approved");
    expect(updated.approvedVia).toBe("telegram");
    expect(telegram.answerCallbackQuery).toHaveBeenCalledWith("cbq-1");
    expect(telegram.editMessageText).toHaveBeenCalledWith(
      "42",
      5,
      expect.stringContaining("Approved"),
      { replyMarkup: { inline_keyboard: [] } },
    );
  });

  it("reject calls the shared action layer and updates the card", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id);
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      callback_query: { id: "cbq-2", data: `idea:reject:${idea.id}`, message: { message_id: 6, chat: { id: 42 } } },
    });

    const [updated] = await db.select().from(ideas).where(eq(ideas.id, idea.id));
    expect(updated.status).toBe("rejected");
    expect(telegram.editMessageText).toHaveBeenCalledWith(
      "42",
      6,
      expect.stringContaining("Rejected"),
      { replyMarkup: { inline_keyboard: [] } },
    );
  });

  it("reports the error instead of crashing when approving an already-decided idea", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id, { status: "approved" });
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      callback_query: { id: "cbq-3", data: `idea:approve:${idea.id}`, message: { message_id: 7, chat: { id: 42 } } },
    });

    expect(telegram.sendMessage).toHaveBeenCalledWith("42", expect.stringContaining("Couldn't do that"));
    expect(telegram.editMessageText).not.toHaveBeenCalled();
  });

  it("edit prompt opens a pending session and asks for replacement text", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id);
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      callback_query: {
        id: "cbq-4",
        data: `idea:editprompt:${idea.id}`,
        message: { message_id: 8, chat: { id: 42 } },
      },
    });

    const session = await getPendingSession(db, "42");
    expect(session).toEqual({
      pendingAction: "awaiting_text",
      pendingEntityType: "idea",
      pendingEntityId: idea.id,
      pendingField: "prompt",
    });
    expect(telegram.sendMessage).toHaveBeenCalledWith("42", expect.stringContaining("replacement prompt"));
  });

  it("edit prompt round trip: button tap opens the session, then a text reply applies it", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id, { prompt: "old prompt" });
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      callback_query: {
        id: "cbq-5",
        data: `idea:editprompt:${idea.id}`,
        message: { message_id: 9, chat: { id: 42 } },
      },
    });
    await processTelegramUpdate(db, telegram, {
      update_id: 2,
      message: { message_id: 10, chat: { id: 42 }, text: "the new prompt text" },
    });

    const [updated] = await db.select().from(ideas).where(eq(ideas.id, idea.id));
    expect(updated.prompt).toBe("the new prompt text");
    expect(await getPendingSession(db, "42")).toBeNull();
  });

  it("change provider opens a picker keyed off a pending session, and setprovider resolves it", async () => {
    const niche = await seedNiche(db);
    const higgsfield = await seedProvider(db, { name: "Higgsfield", unitPrice: "0.10", enabled: true });
    const otherProvider = await seedProvider(db, {
      name: "Nano Banana",
      adapterKey: "nano_banana",
      unitPrice: "0.25",
      enabled: true,
    });
    const idea = await seedIdea(db, niche.id, {
      providerId: higgsfield.id,
      generationSpecs: { resolution: "1080x1920", durationSeconds: 8, aspectRatio: "9:16" },
    });
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      callback_query: {
        id: "cbq-6",
        data: `idea:changeprovider:${idea.id}`,
        message: { message_id: 11, chat: { id: 42 } },
      },
    });

    const session = await getPendingSession(db, "42");
    expect(session?.pendingAction).toBe("choosing_provider");
    expect(session?.pendingEntityId).toBe(idea.id);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      "42",
      "Pick a provider:",
      expect.objectContaining({
        replyMarkup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            [{ text: "Nano Banana — $2.0000", callback_data: `idea:setprovider:${otherProvider.id}` }],
          ]),
        }),
      }),
    );

    await processTelegramUpdate(db, telegram, {
      update_id: 2,
      callback_query: {
        id: "cbq-7",
        data: `idea:setprovider:${otherProvider.id}`,
        message: { message_id: 12, chat: { id: 42 } },
      },
    });

    const [updated] = await db.select().from(ideas).where(eq(ideas.id, idea.id));
    expect(updated.providerId).toBe(otherProvider.id);
    expect(updated.estimatedCost).toBe("2.0000");
    expect(await getPendingSession(db, "42")).toBeNull();
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      "42",
      expect.stringContaining("Nano Banana"),
      expect.objectContaining({ replyMarkup: expect.any(Object) }),
    );
  });

  it("setprovider without a pending session tells the operator the picker expired", async () => {
    const niche = await seedNiche(db);
    const provider = await seedProvider(db);
    await seedIdea(db, niche.id);
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      callback_query: {
        id: "cbq-8",
        data: `idea:setprovider:${provider.id}`,
        message: { message_id: 13, chat: { id: 42 } },
      },
    });

    expect(telegram.sendMessage).toHaveBeenCalledWith("42", expect.stringContaining("expired"));
  });
});

describe("processTelegramUpdate — callback_query (video cards, US-015)", () => {
  let db: Database;

  async function seedPendingVideo(overrides: Partial<typeof videos.$inferInsert> = {}) {
    const niche = await seedNiche(db);
    const provider = await seedProvider(db);
    const idea = await seedIdea(db, niche.id);
    const job = await seedGenerationJob(db, idea.id, provider.id);
    return seedVideo(db, niche.id, idea.id, job.id, overrides);
  }

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("approve calls the shared action layer, acks the tap, and clears the keyboard", async () => {
    const video = await seedPendingVideo({ caption: "Tunnel ride" });
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      callback_query: { id: "cbq-1", data: `video:approve:${video.id}`, message: { message_id: 5, chat: { id: 42 } } },
    });

    const [updated] = await db.select().from(videos).where(eq(videos.id, video.id));
    expect(updated.status).toBe("ready_to_schedule");
    expect(updated.approvedVia).toBe("telegram");
    expect(telegram.answerCallbackQuery).toHaveBeenCalledWith("cbq-1");
    expect(telegram.editMessageReplyMarkup).toHaveBeenCalledWith("42", 5, { inline_keyboard: [] });
    expect(telegram.sendMessage).toHaveBeenCalledWith("42", expect.stringContaining("Approved"));
  });

  it("reject calls the shared action layer and clears the keyboard", async () => {
    const video = await seedPendingVideo();
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      callback_query: { id: "cbq-2", data: `video:reject:${video.id}`, message: { message_id: 6, chat: { id: 42 } } },
    });

    const [updated] = await db.select().from(videos).where(eq(videos.id, video.id));
    expect(updated.status).toBe("rejected");
    expect(telegram.editMessageReplyMarkup).toHaveBeenCalledWith("42", 6, { inline_keyboard: [] });
    expect(telegram.sendMessage).toHaveBeenCalledWith("42", expect.stringContaining("Rejected"));
  });

  it("reports the error instead of crashing when approving an already-decided video", async () => {
    const video = await seedPendingVideo({ status: "rejected" });
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      callback_query: { id: "cbq-3", data: `video:approve:${video.id}`, message: { message_id: 7, chat: { id: 42 } } },
    });

    expect(telegram.sendMessage).toHaveBeenCalledWith("42", expect.stringContaining("Couldn't do that"));
    expect(telegram.editMessageReplyMarkup).not.toHaveBeenCalled();
  });

  it("edit caption opens a pending session and asks for replacement text", async () => {
    const video = await seedPendingVideo();
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      callback_query: {
        id: "cbq-4",
        data: `video:editcaption:${video.id}`,
        message: { message_id: 8, chat: { id: 42 } },
      },
    });

    const session = await getPendingSession(db, "42");
    expect(session).toEqual({
      pendingAction: "awaiting_text",
      pendingEntityType: "video",
      pendingEntityId: video.id,
      pendingField: "caption",
    });
    expect(telegram.sendMessage).toHaveBeenCalledWith("42", expect.stringContaining("replacement caption"));
  });

  it("edit caption round trip: button tap opens the session, then a text reply applies it", async () => {
    const video = await seedPendingVideo({ caption: "old caption" });
    const telegram = fakeTelegramClient();

    await processTelegramUpdate(db, telegram, {
      update_id: 1,
      callback_query: {
        id: "cbq-5",
        data: `video:editcaption:${video.id}`,
        message: { message_id: 9, chat: { id: 42 } },
      },
    });
    await processTelegramUpdate(db, telegram, {
      update_id: 2,
      message: { message_id: 10, chat: { id: 42 }, text: "the new caption text" },
    });

    const [updated] = await db.select().from(videos).where(eq(videos.id, video.id));
    expect(updated.caption).toBe("the new caption text");
    expect(await getPendingSession(db, "42")).toBeNull();
  });
});
