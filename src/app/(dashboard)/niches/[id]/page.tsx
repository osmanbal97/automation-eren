import { and, asc, desc, eq } from "drizzle-orm";
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
import { ideas, videoProviders } from "@/db/schema";
import {
  Badge,
  type BadgeTone,
  Button,
  ButtonLink,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/ui";
import { NicheFormFields } from "../NicheFormFields";
import { generateIdeasAction, updateConnectionStatusAction, updateNicheAction } from "../actions";

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

const STATUS_TONES: Record<string, BadgeTone> = {
  active: "success",
  pending_review: "pending",
  disconnected: "idle",
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

  const [providers, allWithConnections, pendingIdeas] = await Promise.all([
    db.select().from(videoProviders).where(eq(videoProviders.enabled, true)).orderBy(asc(videoProviders.name)),
    listNichesWithConnections(db),
    db
      .select({ id: ideas.id, title: ideas.title, estimatedCost: ideas.estimatedCost })
      .from(ideas)
      .where(and(eq(ideas.nicheId, id), eq(ideas.status, "pending_review")))
      .orderBy(desc(ideas.createdAt)),
  ]);
  const connections = allWithConnections.find((n) => n.id === id)?.connections ?? [];
  const connectionByPlatform = new Map(connections.map((connection) => [connection.platform, connection.status]));

  return (
    <>
      <Link href="/niches" className="text-sm text-fg-muted transition hover:text-fg">
        ← All niches
      </Link>

      <div className="mt-3">
        <PageHeader eyebrow="Niche" title={niche.name} />
      </div>

      <Panel>
        <PanelHeader
          title="Platform connections"
          description="Status is a manual flag, not a live OAuth check — flip a platform to Active only once you know its audit/review has actually passed."
        />
        <div className="space-y-3 px-6 py-6">
          {PLATFORMS.map((platform) => {
            const status = connectionByPlatform.get(platform) ?? "disconnected";
            return (
              <div
                key={platform}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-ink-900/50 px-4 py-3.5"
              >
                <div>
                  <div className="text-sm font-medium capitalize">{platform}</div>
                  <Badge tone={STATUS_TONES[status] ?? "idle"} className="mt-1.5">
                    {statusLabel(platform, status)}
                  </Badge>
                </div>

                <div className="flex gap-2">
                  {status === "disconnected" && (
                    <ConnectionStatusButton
                      nicheId={id}
                      platform={platform}
                      status="pending_review"
                      label="Mark as submitted"
                    />
                  )}
                  {status === "pending_review" && (
                    <>
                      <ConnectionStatusButton
                        nicheId={id}
                        platform={platform}
                        status="active"
                        label="Mark as active"
                        variant="primary"
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
      </Panel>

      <Panel className="mt-6">
        <PanelHeader
          title="Ideas"
          description="Generates 5 concepts via Claude using this niche's theme guidance. Review, edit, approve, or reject each one from the review queue."
          action={
            <form action={generateIdeasAction.bind(null, id)}>
              <Button type="submit" variant="primary">
                ✦ Generate 5 ideas
              </Button>
            </form>
          }
        />
        <div className="px-6 py-6">
          {pendingIdeas.length > 0 ? (
            <ButtonLink href={`/niches/${id}/ideas`} variant="secondary" className="w-full py-4">
              Review {pendingIdeas.length} pending idea{pendingIdeas.length === 1 ? "" : "s"} →
            </ButtonLink>
          ) : (
            <p className="text-sm text-fg-subtle">No ideas pending review yet.</p>
          )}
        </div>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title="Settings" />
        <div className="px-6 py-6">
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
      </Panel>
    </>
  );
}

function ConnectionStatusButton({
  nicheId,
  platform,
  status,
  label,
  variant = "secondary",
}: {
  nicheId: string;
  platform: (typeof PLATFORMS)[number];
  status: "disconnected" | "pending_review" | "active";
  label: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <form action={updateConnectionStatusAction}>
      <input type="hidden" name="nicheId" value={nicheId} />
      <input type="hidden" name="platform" value={platform} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant} size="sm">
        {label}
      </Button>
    </form>
  );
}
