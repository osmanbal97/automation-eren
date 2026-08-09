import { count, eq, sum } from "drizzle-orm";
import { listUpcomingScheduledPosts } from "@/actions/scheduling";
import { getDb } from "@/db/client";
import { ideas, niches, videos } from "@/db/schema";
import { Badge, ButtonLink, EmptyState, PageHeader, Panel, PanelHeader, Stat } from "@/components/ui";
import { getT, toBcp47 } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** Operator overview: the four numbers worth knowing at a glance, plus a jump-off into
 * whichever queue actually needs attention. */
export default async function DashboardHomePage() {
  const { t, locale } = await getT();
  const db = getDb();

  const [[nicheCount], [pendingIdeaCount], [pendingVideoCount], [spend], recentNiches, upcomingPosts] =
    await Promise.all([
      db.select({ value: count() }).from(niches),
      db.select({ value: count() }).from(ideas).where(eq(ideas.status, "pending_review")),
      db.select({ value: count() }).from(videos).where(eq(videos.status, "pending_review")),
      db.select({ value: sum(ideas.estimatedCost) }).from(ideas),
      db.select({ id: niches.id, name: niches.name }).from(niches).limit(6),
      listUpcomingScheduledPosts(db),
    ]);

  const estimatedSpend = Number(spend?.value ?? 0);

  return (
    <>
      <PageHeader
        eyebrow={t.overview.eyebrow}
        title={t.overview.title}
        description={t.overview.description}
        action={
          <ButtonLink href="/niches" variant="primary">
            {t.overview.manageNiches}
          </ButtonLink>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t.overview.stats.niches.label} value={nicheCount?.value ?? 0} hint={t.overview.stats.niches.hint} />
        <Stat
          label={t.overview.stats.ideasPending.label}
          value={pendingIdeaCount?.value ?? 0}
          hint={t.overview.stats.ideasPending.hint}
          tone="accent"
        />
        <Stat
          label={t.overview.stats.videosPending.label}
          value={pendingVideoCount?.value ?? 0}
          hint={t.overview.stats.videosPending.hint}
        />
        <Stat
          label={t.overview.stats.estimatedSpend.label}
          value={`$${estimatedSpend.toFixed(2)}`}
          hint={t.overview.stats.estimatedSpend.hint}
        />
      </div>

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-medium tracking-wide text-fg-subtle uppercase">
          {t.overview.yourNiches}
        </h2>
        {recentNiches.length === 0 ? (
          <EmptyState title={t.overview.noNichesTitle}>
            {t.overview.noNichesBody}{" "}
            <ButtonLink href="/niches" variant="ghost" size="sm" className="ml-1">
              {t.overview.getStarted}
            </ButtonLink>
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentNiches.map((niche) => (
              <Panel key={niche.id} interactive className="p-0">
                <a href={`/niches/${niche.id}`} className="block px-5 py-4">
                  <div className="text-sm font-medium">{niche.name}</div>
                  <div className="mt-1 text-xs text-fg-subtle">{t.overview.openNiche}</div>
                </a>
              </Panel>
            ))}
          </div>
        )}
      </section>

      <Panel className="mt-10">
        <PanelHeader
          title={t.overview.publishingSoon.title}
          description={t.overview.publishingSoon.description}
          action={
            <ButtonLink href="/history" variant="ghost" size="sm">
              {t.overview.publishingSoon.viewAll}
            </ButtonLink>
          }
        />
        <div className="px-6 py-6">
          {upcomingPosts.length === 0 ? (
            <p className="text-sm text-fg-subtle">{t.overview.publishingSoon.empty}</p>
          ) : (
            <ul className="space-y-3">
              {upcomingPosts.map(({ post, video, nicheName }) => (
                <li
                  key={post.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-ink-900/50 px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{nicheName}</span>
                      <Badge tone="idle" className="capitalize">
                        {post.platform}
                      </Badge>
                    </div>
                    <p className="mt-1.5 max-w-xl truncate text-sm text-fg-muted">{video.caption}</p>
                  </div>
                  <span className="shrink-0 text-xs text-fg-subtle">
                    {post.scheduledAt.toLocaleString(toBcp47(locale))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </>
  );
}
