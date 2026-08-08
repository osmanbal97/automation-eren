import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { listNichesWithConnections, type TargetPostsPerDay } from "@/actions/niches";
import { getDb } from "@/db/client";
import { videoProviders } from "@/db/schema";
import { NicheFormFields } from "./NicheFormFields";
import { createNicheAction, deleteNicheAction } from "./actions";

export const dynamic = "force-dynamic";

const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-900/40 text-green-400",
  pending_review: "bg-yellow-900/40 text-yellow-400",
  disconnected: "bg-neutral-800 text-neutral-400",
};

export default async function NichesPage() {
  const db = getDb();
  const [niches, providers] = await Promise.all([
    listNichesWithConnections(db),
    db.select().from(videoProviders).where(eq(videoProviders.enabled, true)).orderBy(asc(videoProviders.name)),
  ]);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold">Niches</h1>
        <p className="mt-2 text-neutral-400">
          Each niche has its own theme, posting cadence, default provider and generation specs.
        </p>

        <div className="mt-8 overflow-hidden rounded-lg border border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Default provider</th>
                <th className="px-4 py-3 font-medium">Target posts/day</th>
                <th className="px-4 py-3 font-medium">Platforms</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {niches.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
                    No niches yet. Create one below.
                  </td>
                </tr>
              ) : (
                niches.map((niche) => {
                  const targets = niche.targetPostsPerDay as TargetPostsPerDay;
                  const connectionByPlatform = new Map(
                    niche.connections.map((connection) => [connection.platform, connection.status]),
                  );
                  return (
                    <tr key={niche.id}>
                      <td className="px-4 py-3">
                        <Link href={`/niches/${niche.id}`} className="font-medium hover:underline">
                          {niche.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-neutral-300">
                        {niche.defaultProviderName ?? <span className="text-neutral-500">none</span>}
                      </td>
                      <td className="px-4 py-3 text-neutral-300">
                        {PLATFORMS.map(
                          (platform) =>
                            `${platform[0].toUpperCase()}${platform.slice(1)}: ${targets[platform] ?? 0}`,
                        ).join(" · ")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {PLATFORMS.map((platform) => {
                            const status = connectionByPlatform.get(platform) ?? "disconnected";
                            return (
                              <span
                                key={platform}
                                className={`rounded-full px-2 py-1 text-xs font-medium ${
                                  STATUS_STYLES[status] ?? STATUS_STYLES.disconnected
                                }`}
                                title={`${platform}: ${status}`}
                              >
                                {platform[0].toUpperCase()}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <form action={deleteNicheAction.bind(null, niche.id)}>
                          <button type="submit" className="text-xs font-medium text-red-400 hover:underline">
                            Delete
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <section className="mt-10 rounded-lg border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="text-lg font-semibold">New niche</h2>
          <div className="mt-4">
            <NicheFormFields action={createNicheAction} providers={providers} submitLabel="Create niche" />
          </div>
        </section>
      </div>
    </main>
  );
}
