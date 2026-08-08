import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { listNichesWithConnections, type TargetPostsPerDay } from "@/actions/niches";
import { getDb } from "@/db/client";
import { videoProviders } from "@/db/schema";
import { Badge, type BadgeTone, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui";
import { NicheFormFields } from "./NicheFormFields";
import { createNicheAction, deleteNicheAction } from "./actions";

export const dynamic = "force-dynamic";

const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;

const STATUS_TONES: Record<string, BadgeTone> = {
  active: "success",
  pending_review: "pending",
  disconnected: "idle",
};

export default async function NichesPage() {
  const db = getDb();
  const [niches, providers] = await Promise.all([
    listNichesWithConnections(db),
    db.select().from(videoProviders).where(eq(videoProviders.enabled, true)).orderBy(asc(videoProviders.name)),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Niches"
        description="Each niche has its own theme, posting cadence, default provider and generation specs."
      />

      {niches.length === 0 ? (
        <EmptyState title="No niches yet">Create your first one below.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {niches.map((niche) => {
            const targets = niche.targetPostsPerDay as TargetPostsPerDay;
            const connectionByPlatform = new Map(
              niche.connections.map((connection) => [connection.platform, connection.status]),
            );
            const totalPerDay = PLATFORMS.reduce(
              (sum, platform) => sum + (targets[platform] ?? 0),
              0,
            );

            return (
              <Panel key={niche.id} interactive className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/niches/${niche.id}`}
                    className="text-base font-semibold tracking-tight hover:text-accent-violet"
                  >
                    {niche.name}
                  </Link>
                  <form action={deleteNicheAction.bind(null, niche.id)}>
                    <button
                      type="submit"
                      className="text-xs font-medium text-fg-subtle transition hover:text-danger"
                    >
                      Delete
                    </button>
                  </form>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs tracking-wide text-fg-subtle uppercase">Provider</dt>
                    <dd className="mt-1 text-fg">
                      {niche.defaultProviderName ?? <span className="text-fg-subtle">none</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs tracking-wide text-fg-subtle uppercase">Posts / day</dt>
                    <dd className="mt-1 tabular-nums text-fg">{totalPerDay}</dd>
                  </div>
                </dl>

                <div className="mt-5 flex flex-wrap gap-2">
                  {PLATFORMS.map((platform) => {
                    const status = connectionByPlatform.get(platform) ?? "disconnected";
                    return (
                      <Badge
                        key={platform}
                        tone={STATUS_TONES[status] ?? "idle"}
                        title={`${platform}: ${status}`}
                      >
                        <span className="capitalize">{platform}</span>
                        <span className="ml-1.5 text-[10px] opacity-70 tabular-nums">
                          {targets[platform] ?? 0}/d
                        </span>
                      </Badge>
                    );
                  })}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <Panel className="mt-10">
        <PanelHeader
          title="New niche"
          description="Theme guidance is what Claude reads when drafting ideas — be specific about mood and visual language."
        />
        <div className="px-6 py-6">
          <NicheFormFields action={createNicheAction} providers={providers} submitLabel="Create niche" />
        </div>
      </Panel>
    </>
  );
}
