import { NextRequest, NextResponse } from "next/server";

/**
 * Stub Telegram webhook receiver: proves the /api/telegram/webhook path is
 * reachable without the dashboard password cookie, gated instead by the
 * secret token Telegram echoes back in X-Telegram-Bot-Api-Secret-Token.
 * Full fast-ack + update handling lands in US-013.
 */
export async function POST(request: NextRequest) {
  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");

  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
