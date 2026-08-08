import { count, eq, sum } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ideas, niches, videos } from "@/db/schema";
import { ButtonLink, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Operator overview: the four numbers worth knowing at a glance, plus a jump-off into
 * whichever queue actually needs attention. */
export default async function DashboardHomePage() {
  const db = getDb();

  const [[nicheCount], [pendingIdeaCount], [pendingVideoCount], [spend], recentNiches] =
    await Promise.all([
      db.select({ value: count() }).from(niches),
      db.select({ value: count() }).from(ideas).where(eq(ideas.status, "pending_review")),
      db.select({ value: count() }).from(videos).where(eq(videos.status, "pending_review")),
      db.select({ value: sum(ideas.estimatedCost) }).from(ideas),
      db.select({ id: niches.id, name: niches.name }).from(niches).limit(6),
    ]);

  const estimatedSpend = Number(spend?.value ?? 0);

  return (
    <>
      <PageHeader
        eyebrow="Console"
        title="Overview"
        description="Ideas are drafted by Claude, approved by you here or in Telegram, rendered by your video provider, then scheduled out to TikTok, Instagram and YouTube."
        action={
          <ButtonLink href="/niches" variant="primary">
            Manage niches
          </ButtonLink>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Niches" value={nicheCount?.value ?? 0} hint="Content streams configured" />
        <Stat
          label="Ideas pending"
          value={pendingIdeaCount?.value ?? 0}
          hint="Awaiting your review"
          tone="accent"
        />
        <Stat
          label="Videos pending"
          value={pendingVideoCount?.value ?? 0}
          hint="Rendered, not yet approved"
        />
        <Stat
          label="Estimated spend"
          value={`$${estimatedSpend.toFixed(2)}`}
          hint="Across all generated ideas"
        />
      </div>

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-medium tracking-wide text-fg-subtle uppercase">
          Your niches
        </h2>
        {recentNiches.length === 0 ? (
          <EmptyState title="No niches yet">
            Create your first niche to start generating ideas.{" "}
            <ButtonLink href="/niches" variant="ghost" size="sm" className="ml-1">
              Get started →
            </ButtonLink>
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentNiches.map((niche) => (
              <Panel key={niche.id} interactive className="p-0">
                <a href={`/niches/${niche.id}`} className="block px-5 py-4">
                  <div className="text-sm font-medium">{niche.name}</div>
                  <div className="mt-1 text-xs text-fg-subtle">Open niche →</div>
                </a>
              </Panel>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
