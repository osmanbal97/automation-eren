import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { seedIdea, seedNiche } from "@/actions/test-helpers";
import type { TelegramClient } from "@/lib/telegram-client";
import {
  formatIdeaCardText,
  ideaCardKeyboard,
  notifyPendingIdeas,
  providerPickerKeyboard,
  sendIdeaCard,
} from "./telegram-idea-card";

function fakeTelegramClient(): TelegramClient {
  return {
    sendMessage: vi.fn(async () => 1),
    editMessageText: vi.fn(async () => {}),
    answerCallbackQuery: vi.fn(async () => {}),
  };
}

describe("formatIdeaCardText", () => {
  it("includes title, concept, prompt, caption, and the provider + estimated cost", () => {
    const idea = {
      id: "idea-1",
      title: "Tunnel ride",
      concept: "POV bike ride",
      prompt: "first-person, bike, tunnel",
      caption: "into the void",
      estimatedCost: "0.8000",
    } as never;
    const provider = { name: "Higgsfield" } as never;

    const text = formatIdeaCardText(idea, provider);

    expect(text).toContain("Tunnel ride");
    expect(text).toContain("POV bike ride");
    expect(text).toContain("first-person, bike, tunnel");
    expect(text).toContain("into the void");
    expect(text).toContain("Higgsfield");
    expect(text).toContain("0.8000");
  });

  it("shows a placeholder when no provider is set yet", () => {
    const idea = { title: "t", concept: "c", prompt: "p", caption: "cap", estimatedCost: null } as never;

    expect(formatIdeaCardText(idea, null)).toContain("none picked yet");
  });
});

describe("ideaCardKeyboard", () => {
  it("has approve/reject, edit prompt/caption, and change provider buttons, all carrying the idea id", () => {
    const keyboard = ideaCardKeyboard("idea-42");
    const allButtons = keyboard.inline_keyboard.flat();

    expect(allButtons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ callback_data: "idea:approve:idea-42" }),
        expect.objectContaining({ callback_data: "idea:reject:idea-42" }),
        expect.objectContaining({ callback_data: "idea:editprompt:idea-42" }),
        expect.objectContaining({ callback_data: "idea:editcaption:idea-42" }),
        expect.objectContaining({ callback_data: "idea:changeprovider:idea-42" }),
      ]),
    );
  });
});

describe("providerPickerKeyboard", () => {
  it("labels each provider button with its price for the given specs, without the idea id", () => {
    const providers = [
      { id: "p1", name: "Higgsfield", pricingModel: "per_second", unitPrice: "0.10" },
      { id: "p2", name: "Omni", pricingModel: "per_generation", unitPrice: "1.50" },
    ] as never;

    const keyboard = providerPickerKeyboard(providers, { resolution: "1080x1920", durationSeconds: 8 });

    expect(keyboard.inline_keyboard).toEqual([
      [{ text: "Higgsfield — $0.8000", callback_data: "idea:setprovider:p1" }],
      [{ text: "Omni — $1.5000", callback_data: "idea:setprovider:p2" }],
    ]);
  });
});

describe("sendIdeaCard", () => {
  it("sends the formatted card text with the action keyboard attached", async () => {
    const telegram = fakeTelegramClient();
    const idea = { id: "idea-1", title: "t", concept: "c", prompt: "p", caption: "cap", estimatedCost: null } as never;

    const messageId = await sendIdeaCard(telegram, "42", idea, null);

    expect(messageId).toBe(1);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      "42",
      expect.stringContaining("t"),
      expect.objectContaining({ replyMarkup: ideaCardKeyboard("idea-1") }),
    );
  });
});

describe("notifyPendingIdeas", () => {
  let db: Database;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
    process.env = { ...originalEnv };
  });

  it("is a no-op when Telegram isn't configured", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_OPERATOR_CHAT_ID;
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id);

    // Should resolve without throwing even though no bot token/chat id/fetch exist.
    await expect(notifyPendingIdeas(db, [idea])).resolves.toBeUndefined();
  });

  it("is a no-op for an empty idea list even when Telegram is configured", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_OPERATOR_CHAT_ID = "42";

    await expect(notifyPendingIdeas(db, [])).resolves.toBeUndefined();
  });
});
