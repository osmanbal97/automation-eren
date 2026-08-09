import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { seedGenerationJob, seedIdea, seedNiche, seedProvider, seedVideo } from "@/actions/test-helpers";
import type { TelegramClient } from "@/lib/telegram-client";
import {
  getVideoById,
  notifyPendingVideo,
  regeneratePickerKeyboard,
  sendVideoCard,
  TELEGRAM_DIRECT_VIDEO_LIMIT_BYTES,
  videoCardKeyboard,
} from "./telegram-video-card";

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

describe("videoCardKeyboard", () => {
  it("has approve/reject, edit caption, and regenerate buttons, all carrying the video id", () => {
    const keyboard = videoCardKeyboard("video-42");
    const allButtons = keyboard.inline_keyboard.flat();

    expect(allButtons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ callback_data: "video:approve:video-42" }),
        expect.objectContaining({ callback_data: "video:reject:video-42" }),
        expect.objectContaining({ callback_data: "video:editcaption:video-42" }),
        expect.objectContaining({ callback_data: "video:regenerate:video-42" }),
      ]),
    );
  });
});

describe("regeneratePickerKeyboard", () => {
  it("has edit-prompt and optimize-prompt buttons, both carrying the video id", () => {
    const keyboard = regeneratePickerKeyboard("video-42");
    const allButtons = keyboard.inline_keyboard.flat();

    expect(allButtons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ callback_data: "video:regenerateedit:video-42" }),
        expect.objectContaining({ callback_data: "video:regenerateoptimize:video-42" }),
      ]),
    );
  });
});

describe("sendVideoCard — size-based branch (US-015 acceptance criterion)", () => {
  it("sends the video directly when it's under Telegram's size limit", async () => {
    const telegram = fakeTelegramClient();
    const video = {
      id: "v1",
      blobUrl: "https://blob.example.com/v1.mp4",
      thumbnailBlobUrl: null,
      sizeBytes: TELEGRAM_DIRECT_VIDEO_LIMIT_BYTES - 1,
      caption: "into the void",
      hashtags: ["trippy"],
    } as never;

    const messageId = await sendVideoCard(telegram, "42", video);

    expect(messageId).toBe(1);
    expect(telegram.sendVideo).toHaveBeenCalledWith("42", "https://blob.example.com/v1.mp4", {
      caption: "into the void\n#trippy",
      replyMarkup: videoCardKeyboard("v1"),
    });
    expect(telegram.sendPhoto).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("falls back to a thumbnail + link when the video is over the size limit but has a thumbnail", async () => {
    const telegram = fakeTelegramClient();
    const video = {
      id: "v2",
      blobUrl: "https://blob.example.com/v2.mp4",
      thumbnailBlobUrl: "https://blob.example.com/v2-thumb.jpg",
      sizeBytes: TELEGRAM_DIRECT_VIDEO_LIMIT_BYTES + 1,
      caption: "into the void",
      hashtags: [],
    } as never;

    const messageId = await sendVideoCard(telegram, "42", video);

    expect(messageId).toBe(1);
    expect(telegram.sendPhoto).toHaveBeenCalledWith("42", "https://blob.example.com/v2-thumb.jpg", {
      caption: expect.stringContaining("Full video: https://blob.example.com/v2.mp4"),
      replyMarkup: videoCardKeyboard("v2"),
    });
    expect(telegram.sendVideo).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("falls back to a plain text message with a link when there's no thumbnail either", async () => {
    const telegram = fakeTelegramClient();
    const video = {
      id: "v3",
      blobUrl: "https://blob.example.com/v3.mp4",
      thumbnailBlobUrl: null,
      sizeBytes: null,
      caption: "into the void",
      hashtags: [],
    } as never;

    const messageId = await sendVideoCard(telegram, "42", video);

    expect(messageId).toBe(1);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      "42",
      expect.stringContaining("Watch: https://blob.example.com/v3.mp4"),
      { replyMarkup: videoCardKeyboard("v3") },
    );
    expect(telegram.sendVideo).not.toHaveBeenCalled();
    expect(telegram.sendPhoto).not.toHaveBeenCalled();
  });
});

describe("notifyPendingVideo", () => {
  let db: Database;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
    process.env = { ...originalEnv };
  });

  async function seedPendingVideo() {
    const niche = await seedNiche(db);
    const provider = await seedProvider(db);
    const idea = await seedIdea(db, niche.id);
    const job = await seedGenerationJob(db, idea.id, provider.id);
    return seedVideo(db, niche.id, idea.id, job.id);
  }

  it("is a no-op when Telegram isn't configured", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_OPERATOR_CHAT_ID;
    const video = await seedPendingVideo();

    await expect(notifyPendingVideo(db, video)).resolves.toBeUndefined();
  });
});

describe("getVideoById", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("returns the video row when it exists", async () => {
    const niche = await seedNiche(db);
    const provider = await seedProvider(db);
    const idea = await seedIdea(db, niche.id);
    const job = await seedGenerationJob(db, idea.id, provider.id);
    const video = await seedVideo(db, niche.id, idea.id, job.id);

    const found = await getVideoById(db, video.id);

    expect(found?.id).toBe(video.id);
  });

  it("returns null when the video doesn't exist", async () => {
    const found = await getVideoById(db, "00000000-0000-0000-0000-000000000000");

    expect(found).toBeNull();
  });
});
