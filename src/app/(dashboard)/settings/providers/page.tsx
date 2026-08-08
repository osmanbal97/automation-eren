import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { videoProviders } from "@/db/schema";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

const PRICING_LABELS: Record<string, string> = {
  per_second: "per second",
  per_generation: "per generation",
  per_credit: "per credit",
};

export default async function ProvidersSettingsPage() {
  const db = getDb();
  const providers = await db.select().from(videoProviders).orderBy(asc(videoProviders.name));

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Video providers"
        description="Providers available for video generation. Disabled providers are placeholders until their adapter is built, but already show pricing for planning."
      />

      {providers.length === 0 ? (
        <EmptyState title="No providers seeded yet">
          Run <code className="rounded bg-white/10 px-1.5 py-0.5">npm run db:seed:providers</code>.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {providers.map((provider) => (
            <Panel key={provider.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold tracking-tight">{provider.name}</div>
                  <div className="mt-0.5 font-mono text-xs text-fg-subtle">{provider.adapterKey}</div>
                </div>
                <Badge tone={provider.enabled ? "success" : "idle"}>
                  {provider.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>

              <div className="mt-5 flex items-end justify-between border-t border-line pt-4">
                <div>
                  <div className="text-xs tracking-wide text-fg-subtle uppercase">Unit price</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">${provider.unitPrice}</div>
                </div>
                <div className="text-sm text-fg-muted">
                  {PRICING_LABELS[provider.pricingModel] ?? provider.pricingModel}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
