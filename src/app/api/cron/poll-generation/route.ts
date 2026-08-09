import { NextRequest, NextResponse } from "next/server";
import { pollAllGenerationJobs } from "@/actions/generation-jobs";
import { getDb } from "@/db/client";
import { createDrizzleErrorLogStore } from "@/lib/error-log";

/**
 * US-016's poller: advances every in-flight generation_jobs row by asking its
 * provider for the current status. Gated by CRON_SECRET like every other
 * /api/cron/* route (these bypass the dashboard password cookie).
 *
 * Unlike the Telegram webhook, this deliberately awaits the work and reports a
 * summary: Vercel Cron does not read the response body, but a synchronous run
 * means a failure shows up in the function logs as a real error rather than
 * being silently swallowed in a deferred task.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;

  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const summary = await pollAllGenerationJobs(db, {
    errorLogStore: createDrizzleErrorLogStore(db),
  });

  return NextResponse.json({ ok: true, ...summary, timestamp: new Date().toISOString() });
}
