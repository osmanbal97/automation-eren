import { NextRequest, NextResponse } from "next/server";

/**
 * Trivial health-check cron route: proves the /api/cron/* prefix is reachable
 * without the dashboard password cookie, gated instead by CRON_SECRET.
 * Real cron jobs (poll-generation, publish) land in later phases.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;

  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ ok: true, timestamp: new Date().toISOString() });
}
