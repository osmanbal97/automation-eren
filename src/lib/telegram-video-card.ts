import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { videos } from "@/db/schema";
import { createDrizzleErrorLogStore } from "@/lib/error-log";
import { createTelegramClient, type InlineKeyboardMarkup, type TelegramClient } from "@/lib/telegram-client";

type Video = typeof videos.$inferSelect;

/** Telegram Bot API's practical limit for a bot-sent video (by URL or upload). Videos
 * over this go out as a thumbnail + link instead of a direct playable message. */
export const TELEGRAM_DIRECT_VIDEO_LIMIT_BYTES = 50 * 1024 * 1024;

function formatCaption(video: Video): string {
  const hashtags = Array.isArray(video.hashtags) ? (video.hashtags as string[]) : [];
  const hashtagLine = hashtags.length > 0 ? `\n${hashtags.map((tag) => `#${tag}`).join(" ")}` : "";
  return `${video.caption}${hashtagLine}`;
}

/** Approve/Reject/Edit Caption/Regenerate keyboard for a video card. Callback data
 * carries only the video id, mirroring US-014's idea cards. Regenerate opens a picker
 * (edit the prompt by hand, or have Claude optimize it) rather than acting immediately,
 * since it needs a follow-up text reply either way. */
export function videoCardKeyboard(videoId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `video:approve:${videoId}` },
        { text: "❌ Reject", callback_data: `video:reject:${videoId}` },
      ],
      [{ text: "✏️ Edit Caption", callback_data: `video:editcaption:${videoId}` }],
      [{ text: "🔁 Regenerate", callback_data: `video:regenerate:${videoId}` }],
    ],
  };
}

/** Edit-prompt vs. optimize-prompt picker shown after tapping Regenerate. */
export function regeneratePickerKeyboard(videoId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✏️ Edit prompt", callback_data: `video:regenerateedit:${videoId}` },
        { text: "✨ Optimize prompt", callback_data: `video:regenerateoptimize:${videoId}` },
      ],
    ],
  };
}

/**
 * Sends a completed video to the operator's chat (US-015): a direct playable video
 * when it's under Telegram's size limit, otherwise a thumbnail with a Blob link in the
 * caption, or -- if there's no thumbnail either -- a plain text message with the link.
 * Telegram fetches "by URL" media server-side, so this needs no local download/upload.
 */
export async function sendVideoCard(telegram: TelegramClient, chatId: string, video: Video): Promise<number> {
  const caption = formatCaption(video);
  const replyMarkup = videoCardKeyboard(video.id);

  if (video.sizeBytes !== null && video.sizeBytes <= TELEGRAM_DIRECT_VIDEO_LIMIT_BYTES) {
    return telegram.sendVideo(chatId, video.blobUrl, { caption, replyMarkup });
  }
  if (video.thumbnailBlobUrl) {
    return telegram.sendPhoto(chatId, video.thumbnailBlobUrl, {
      caption: `${caption}\n\nFull video: ${video.blobUrl}`,
      replyMarkup,
    });
  }
  return telegram.sendMessage(chatId, `${caption}\n\nWatch: ${video.blobUrl}`, { replyMarkup });
}

/**
 * Pushes a freshly-generated video to the operator's Telegram chat. A no-op when
 * Telegram isn't configured; not yet called from anywhere in this codebase since
 * nothing produces `videos` rows yet (that's US-016/US-017's job) -- wiring the actual
 * call site in after storing a completed video is part of landing those stories.
 */
export async function notifyPendingVideo(db: Database, video: Video): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID;
  if (!botToken || !chatId) {
    return;
  }
  const telegram = createTelegramClient({ botToken, errorLogStore: createDrizzleErrorLogStore(db) });
  try {
    await sendVideoCard(telegram, chatId, video);
  } catch (error) {
    console.error("Failed to push video card to Telegram", error);
  }
}

// Re-exported so callers that already have a video id can re-fetch + edit a live card
// without importing drizzle helpers directly (used by telegram-webhook.ts).
export async function getVideoById(db: Database, videoId: string): Promise<Video | null> {
  const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
  return video ?? null;
}
