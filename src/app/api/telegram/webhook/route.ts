import { after, NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { createDrizzleErrorLogStore } from "@/lib/error-log";
import { createTelegramClient } from "@/lib/telegram-client";
import { handleTelegramWebhook, processTelegramUpdate, type TelegramUpdate } from "@/lib/telegram-webhook";

/**
 * Telegram webhook receiver (US-013). Auth + fast-ack logic lives in
 * handleTelegramWebhook so it's unit-testable without Next's request-scoped `after()`
 * (which throws if invoked outside a real request); this route is just the thin
 * adapter that wires real env vars, a real DB, and Next's `after` into it.
 */
export async function POST(request: NextRequest) {
  const update = (await request.json()) as TelegramUpdate;

  const result = handleTelegramWebhook({
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    secretHeader: request.headers.get("x-telegram-bot-api-secret-token"),
    update,
    scheduleAsync: after,
    processUpdate: async (u) => {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return;
      }
      const db = getDb();
      const telegram = createTelegramClient({ botToken, errorLogStore: createDrizzleErrorLogStore(db) });
      try {
        await processTelegramUpdate(db, telegram, u);
      } catch (error) {
        console.error("Failed to process Telegram update", error);
      }
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
