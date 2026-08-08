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
import { updateNicheAction } from "../actions";

export const dynamic = "force-dynamic";

const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;
const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  pending_review: "Pending review",
  disconnected: "Disconnected",
};

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

        <div className="mt-6 flex flex-wrap gap-2">
          {PLATFORMS.map((platform) => {
            const status = connectionByPlatform.get(platform) ?? "disconnected";
            return (
              <span
                key={platform}
                className="rounded-full bg-neutral-800 px-2.5 py-1 text-xs font-medium capitalize text-neutral-300"
              >
                {platform}: {STATUS_LABELS[status] ?? status}
              </span>
            );
          })}
        </div>

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
