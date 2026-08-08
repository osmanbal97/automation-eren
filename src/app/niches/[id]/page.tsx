import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getNiche,
  listNichesWithConnections,
  type NicheGenerationSpecs,
  type TargetPostsPerDay,
} from "@/actions/niches";
import { ActionNotFoundError } from "@/actions/errors";
import { getDb } from "@/db/client";
import { videoProviders } from "@/db/schema";
import { NicheFormFields } from "../NicheFormFields";
import { updateConnectionStatusAction, updateNicheAction } from "../actions";

export const dynamic = "force-dynamic";

const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;

/** Per-platform copy for what "pending" actually means, per the PRD's "waiting on TikTok
 * audit" / "waiting on Meta app review" wording — a generic "Pending review" label doesn't
 * tell the operator which external process they're actually waiting on. */
const PENDING_LABELS: Record<(typeof PLATFORMS)[number], string> = {
  tiktok: "Waiting on TikTok audit",
  instagram: "Waiting on Meta app review",
  youtube: "Waiting on Google OAuth verification",
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-900/40 text-green-400",
  pending_review: "bg-yellow-900/40 text-yellow-400",
  disconnected: "bg-neutral-800 text-neutral-400",
};

function statusLabel(platform: (typeof PLATFORMS)[number], status: string) {
  if (status === "active") return "Active";
  if (status === "pending_review") return PENDING_LABELS[platform];
  return "Not connected";
}

export default async function EditNichePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  let niche;
  try {
    niche = await getNiche(db, id);
  } catch (error) {
    if (error instanceof ActionNotFoundError) {
      notFound();
    }
    throw error;
  }

  const [providers, allWithConnections] = await Promise.all([
    db.select().from(videoProviders).where(eq(videoProviders.enabled, true)).orderBy(asc(videoProviders.name)),
    listNichesWithConnections(db),
  ]);
  const connections = allWithConnections.find((n) => n.id === id)?.connections ?? [];
  const connectionByPlatform = new Map(connections.map((connection) => [connection.platform, connection.status]));

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-2xl">
        <Link href="/niches" className="text-sm text-neutral-400 hover:underline">
          &larr; Niches
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit {niche.name}</h1>

        <section className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="text-lg font-semibold">Platform connections</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Status is a manual flag, not a live OAuth check — flip a platform to Active only once
            you know its audit/review has actually passed.
          </p>

          <div className="mt-4 space-y-3">
            {PLATFORMS.map((platform) => {
              const status = connectionByPlatform.get(platform) ?? "disconnected";
              return (
                <div
                  key={platform}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-medium capitalize">{platform}</div>
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[status] ?? STATUS_STYLES.disconnected
                      }`}
                    >
                      {statusLabel(platform, status)}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    {status === "disconnected" && (
                      <ConnectionStatusButton
                        nicheId={id}
                        platform={platform}
                        status="pending_review"
                        label="Mark as submitted for review"
                      />
                    )}
                    {status === "pending_review" && (
                      <>
                        <ConnectionStatusButton
                          nicheId={id}
                          platform={platform}
                          status="active"
                          label="Mark as active"
                          primary
                        />
                        <ConnectionStatusButton
                          nicheId={id}
                          platform={platform}
                          status="disconnected"
                          label="Reset"
                        />
                      </>
                    )}
                    {status === "active" && (
                      <ConnectionStatusButton
                        nicheId={id}
                        platform={platform}
                        status="disconnected"
                        label="Disconnect"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900 p-6">
          <NicheFormFields
            action={updateNicheAction.bind(null, id)}
            providers={providers}
            submitLabel="Save changes"
            defaults={{
              name: niche.name,
              themeGuidance: niche.themeGuidance,
              targetPostsPerDay: niche.targetPostsPerDay as TargetPostsPerDay,
              defaultProviderId: niche.defaultProviderId,
              defaultGenerationSpecs: niche.defaultGenerationSpecs as NicheGenerationSpecs,
            }}
          />
        </div>
      </div>
    </main>
  );
}

function ConnectionStatusButton({
  nicheId,
  platform,
  status,
  label,
  primary,
}: {
  nicheId: string;
  platform: (typeof PLATFORMS)[number];
  status: "disconnected" | "pending_review" | "active";
  label: string;
  primary?: boolean;
}) {
  return (
    <form action={updateConnectionStatusAction}>
      <input type="hidden" name="nicheId" value={nicheId} />
      <input type="hidden" name="platform" value={platform} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        className={
          primary
            ? "rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 transition hover:bg-white"
            : "rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-neutral-500"
        }
      >
        {label}
      </button>
    </form>
  );
}
