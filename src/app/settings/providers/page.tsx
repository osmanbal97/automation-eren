import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { videoProviders } from "@/db/schema";

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
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">Video providers</h1>
        <p className="mt-2 text-neutral-400">
          Providers available for video generation. Disabled providers are placeholders until
          their adapter is built, but already show pricing for planning.
        </p>

        <div className="mt-8 overflow-hidden rounded-lg border border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Pricing model</th>
                <th className="px-4 py-3 font-medium">Unit price</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {providers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                    No providers seeded yet. Run <code>npm run db:seed:providers</code>.
                  </td>
                </tr>
              ) : (
                providers.map((provider) => (
                  <tr key={provider.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{provider.name}</div>
                      <div className="text-xs text-neutral-500">{provider.adapterKey}</div>
                    </td>
                    <td className="px-4 py-3 text-neutral-300">
                      {PRICING_LABELS[provider.pricingModel] ?? provider.pricingModel}
                    </td>
                    <td className="px-4 py-3 text-neutral-300">${provider.unitPrice}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          provider.enabled
                            ? "rounded-full bg-green-900/40 px-2 py-1 text-xs font-medium text-green-400"
                            : "rounded-full bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-400"
                        }
                      >
                        {provider.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
