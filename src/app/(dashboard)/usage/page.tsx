import { eq, sum } from "drizzle-orm";
import { getDb } from "@/db/client";
import { apiQuotaUsage, generationJobs, ideas, niches, videoProviders } from "@/db/schema";
import { YOUTUBE_DEFAULT_DAILY_QUOTA } from "@/lib/platforms/youtube";
import { EmptyState, PageHeader, Panel, PanelHeader, Stat } from "@/components/ui";
import { getT } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** Daily caps we actually know, keyed by the same provider string api_quota_usage rows
 * use. Only YouTube's publish quota (US-021/024's checkQuota call) is a real,
 * enforced cap today -- TikTok and Instagram's publish adapters don't consume this
 * counter yet, so any usage without a known cap here is shown as uncapped rather than
 * guessed at. */
const KNOWN_DAILY_CAPS: Record<string, number> = {
  youtube: YOUTUBE_DEFAULT_DAILY_QUOTA,
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function money(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

/** Quota and spend dashboard (US-026): today's per-provider API usage against whatever
 * daily cap is actually known, plus running video-generation spend broken down by
 * provider and by niche -- estimated (ideas.estimated_cost, set at idea-creation time)
 * alongside actual (generation_jobs.actual_cost, only populated once a job completes). */
export default async function UsagePage() {
  const { t } = await getT();
  const db = getDb();
  const today = todayUtc();

  const [quotaRows, providers, allNiches, estimatedByProvider, actualByProvider, estimatedByNiche, actualByNiche] =
    await Promise.all([
      db.select().from(apiQuotaUsage).where(eq(apiQuotaUsage.usageDate, today)),
      db.select().from(videoProviders),
      db.select({ id: niches.id, name: niches.name }).from(niches),
      db
        .select({ providerId: ideas.providerId, total: sum(ideas.estimatedCost) })
        .from(ideas)
        .groupBy(ideas.providerId),
      db
        .select({ providerId: generationJobs.providerId, total: sum(generationJobs.actualCost) })
        .from(generationJobs)
        .groupBy(generationJobs.providerId),
      db
        .select({ nicheId: ideas.nicheId, total: sum(ideas.estimatedCost) })
        .from(ideas)
        .groupBy(ideas.nicheId),
      db
        .select({ nicheId: ideas.nicheId, total: sum(generationJobs.actualCost) })
        .from(generationJobs)
        .innerJoin(ideas, eq(generationJobs.ideaId, ideas.id))
        .groupBy(ideas.nicheId),
    ]);

  const estimatedByProviderMap = new Map(estimatedByProvider.map((r) => [r.providerId, money(r.total)]));
  const actualByProviderMap = new Map(actualByProvider.map((r) => [r.providerId, money(r.total)]));
  const estimatedByNicheMap = new Map(estimatedByNiche.map((r) => [r.nicheId, money(r.total)]));
  const actualByNicheMap = new Map(actualByNiche.map((r) => [r.nicheId, money(r.total)]));

  const totalEstimated = estimatedByProvider.reduce((acc, r) => acc + money(r.total), 0);
  const totalActual = actualByProvider.reduce((acc, r) => acc + money(r.total), 0);

  return (
    <>
      <PageHeader
        eyebrow={t.usage.eyebrow}
        title={t.usage.title}
        description={t.usage.description}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t.usage.totalEstimated.label}
          value={`$${totalEstimated.toFixed(2)}`}
          hint={t.usage.totalEstimated.hint}
        />
        <Stat
          label={t.usage.totalActual.label}
          value={`$${totalActual.toFixed(2)}`}
          hint={t.usage.totalActual.hint}
          tone="accent"
        />
      </div>

      <Panel className="mt-6">
        <PanelHeader title={t.usage.quotaPanel.title} description={t.usage.quotaPanel.description} />
        <div className="px-6 py-6">
          {quotaRows.length === 0 ? (
            <EmptyState title={t.usage.noUsageToday} />
          ) : (
            <ul className="space-y-3">
              {quotaRows.map((row) => {
                const cap = KNOWN_DAILY_CAPS[row.provider];
                const pct = cap ? Math.min(100, Math.round((row.unitsUsed / cap) * 100)) : null;
                return (
                  <li key={row.id} className="rounded-lg border border-line bg-ink-900/50 px-4 py-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-sm font-medium capitalize">{row.provider}</span>
                      <span className="text-sm text-fg-muted tabular-nums">
                        {t.usage.quotaLine(row.unitsUsed.toLocaleString(), cap ? cap.toLocaleString() : null, pct)}
                      </span>
                    </div>
                    {cap ? (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="bg-accent-gradient h-full rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title={t.usage.providerSpendTitle} />
        <div className="px-6 py-6">
          {providers.length === 0 ? (
            <EmptyState title={t.usage.noProviders} />
          ) : (
            <ul className="space-y-3">
              {providers.map((provider) => (
                <li
                  key={provider.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-ink-900/50 px-4 py-3.5"
                >
                  <span className="text-sm font-medium">{provider.name}</span>
                  <span className="text-sm text-fg-muted tabular-nums">
                    {t.usage.spendLine(
                      estimatedByProviderMap.get(provider.id)?.toFixed(2) ?? "0.00",
                      actualByProviderMap.get(provider.id)?.toFixed(2) ?? "0.00",
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title={t.usage.nicheSpendTitle} />
        <div className="px-6 py-6">
          {allNiches.length === 0 ? (
            <EmptyState title={t.usage.noNiches} />
          ) : (
            <ul className="space-y-3">
              {allNiches.map((niche) => (
                <li
                  key={niche.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-ink-900/50 px-4 py-3.5"
                >
                  <span className="text-sm font-medium">{niche.name}</span>
                  <span className="text-sm text-fg-muted tabular-nums">
                    {t.usage.spendLine(
                      estimatedByNicheMap.get(niche.id)?.toFixed(2) ?? "0.00",
                      actualByNicheMap.get(niche.id)?.toFixed(2) ?? "0.00",
                    )}
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
