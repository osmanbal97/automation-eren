import { NextRequest, NextResponse } from "next/server";
import { runPublishWorkerTick } from "@/actions/publish-worker";
import { getDb } from "@/db/client";
import { createDrizzleErrorLogStore } from "@/lib/error-log";
import { buildPlatformAdapters } from "@/lib/platforms/registry";

/**
 * US-024's publish worker: claims every due scheduled_posts row (FOR UPDATE SKIP
 * LOCKED, so an overlapping run never double-claims one) and attempts each through its
 * platform adapter, retrying up to a max before marking a post permanently failed.
 * Gated by CRON_SECRET like every other /api/cron/* route.
 *
 * Deliberately synchronous like /api/cron/poll-generation: Vercel Cron ignores the
 * response body, but awaiting the work means a failure surfaces in the function logs
 * as a real error instead of being silently swallowed.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;

  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const errorLogStore = createDrizzleErrorLogStore(db);
  const adapters = buildPlatformAdapters(db, { errorLogStore });
  const summary = await runPublishWorkerTick(db, adapters, "web");

  return NextResponse.json({ ok: true, ...summary, timestamp: new Date().toISOString() });
}
