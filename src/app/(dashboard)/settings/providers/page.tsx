import { asc } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { niches, videoProviders } from "@/db/schema";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";
import { getT } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ProvidersSettingsPage() {
  const { t } = await getT();
  const db = getDb();
  const [providers, allNiches] = await Promise.all([
    db.select().from(videoProviders).orderBy(asc(videoProviders.name)),
    db.select({ id: niches.id, name: niches.name, providerId: niches.defaultProviderId }).from(niches),
  ]);

  const nichesByProvider = new Map<string, { id: string; name: string }[]>();
  for (const niche of allNiches) {
    if (!niche.providerId) continue;
    const existing = nichesByProvider.get(niche.providerId) ?? [];
    existing.push({ id: niche.id, name: niche.name });
    nichesByProvider.set(niche.providerId, existing);
  }

  return (
    <>
      <PageHeader
        eyebrow={t.providers.eyebrow}
        title={t.providers.title}
        description={t.providers.description}
      />

      {providers.length === 0 ? (
        <EmptyState title={t.providers.emptyTitle}>
          {t.providers.emptyBodyPrefix}{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5">npm run db:seed:providers</code>
          {t.providers.emptyBodySuffix}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {providers.map((provider) => {
            const usedBy = nichesByProvider.get(provider.id) ?? [];
            return (
              <Panel key={provider.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-semibold tracking-tight">{provider.name}</div>
                    <div className="mt-0.5 font-mono text-xs text-fg-subtle">{provider.adapterKey}</div>
                  </div>
                  <Badge tone={provider.enabled ? "success" : "idle"}>
                    {provider.enabled ? t.providers.enabled : t.providers.disabled}
                  </Badge>
                </div>

                <div className="mt-5 flex items-end justify-between border-t border-line pt-4">
                  <div>
                    <div className="text-xs tracking-wide text-fg-subtle uppercase">{t.providers.unitPrice}</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums">${provider.unitPrice}</div>
                  </div>
                  <div className="text-sm text-fg-muted">
                    {t.status.pricing[provider.pricingModel as keyof typeof t.status.pricing] ?? provider.pricingModel}
                  </div>
                </div>

                <div className="mt-4 border-t border-line pt-4">
                  <div className="text-xs tracking-wide text-fg-subtle uppercase">{t.providers.usedBy}</div>
                  {usedBy.length === 0 ? (
                    <p className="mt-1.5 text-sm text-fg-subtle">{t.providers.notUsedYet}</p>
                  ) : (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {usedBy.map((niche) => (
                        <li key={niche.id}>
                          <Link
                            href={`/niches/${niche.id}`}
                            className="inline-block rounded-full border border-line bg-ink-900/50 px-2.5 py-1 text-xs text-fg-muted transition hover:text-fg"
                          >
                            {niche.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
