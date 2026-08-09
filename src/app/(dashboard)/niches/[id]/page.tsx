import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listGenerationJobsForNiche } from "@/actions/generation-jobs";
import {
  getNiche,
  listNichesWithConnections,
  type NicheGenerationSpecs,
  type TargetPostsPerDay,
} from "@/actions/niches";
import { ActionNotFoundError } from "@/actions/errors";
import { getDb } from "@/db/client";
import { ideas, videoProviders, videos } from "@/db/schema";
import { Badge, type BadgeTone, Button, ButtonLink, PageHeader, Panel, PanelHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { connectionResultMessage, connectionStatusLabel, PLATFORMS, STATUS_TONES } from "@/lib/platform-connection-ui";
import { NicheFormFields } from "../NicheFormFields";
import { generateIdeasAction, updateConnectionStatusAction, updateNicheAction } from "../actions";

export const dynamic = "force-dynamic";

const JOB_STATUS_TONES: Record<string, BadgeTone> = {
  queued: "idle",
  processing: "pending",
  complete: "success",
  failed: "danger",
};

export default async function EditNichePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connected?: string; connection_error?: string; reason?: string }>;
}) {
  const { t } = await getT();
  const { id } = await params;
  const { connected, connection_error: connectionError, reason } = await searchParams;
  const banner = connectionResultMessage(t.connectionStatus, { connected, connectionError, reason });
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

  const [providers, allWithConnections, pendingIdeas, generationJobRows, pendingVideos, readyVideos] =
    await Promise.all([
      db.select().from(videoProviders).where(eq(videoProviders.enabled, true)).orderBy(asc(videoProviders.name)),
      listNichesWithConnections(db),
      db
        .select({ id: ideas.id, title: ideas.title, estimatedCost: ideas.estimatedCost })
        .from(ideas)
        .where(and(eq(ideas.nicheId, id), eq(ideas.status, "pending_review")))
        .orderBy(desc(ideas.createdAt)),
      listGenerationJobsForNiche(db, id),
      db
        .select({ id: videos.id })
        .from(videos)
        .where(and(eq(videos.nicheId, id), eq(videos.status, "pending_review"))),
      db
        .select({ id: videos.id })
        .from(videos)
        .where(and(eq(videos.nicheId, id), eq(videos.status, "ready_to_schedule"))),
    ]);
  const generationJobs = [...generationJobRows].reverse();
  const connections = allWithConnections.find((n) => n.id === id)?.connections ?? [];
  const connectionByPlatform = new Map(connections.map((connection) => [connection.platform, connection.status]));

  return (
    <>
      <Link href="/niches" className="text-sm text-fg-muted transition hover:text-fg">
        ← {t.nicheDetail.allNiches}
      </Link>

      <div className="mt-3">
        <PageHeader eyebrow="Niche" title={niche.name} />
      </div>

      {banner && (
        <div
          className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
            banner.tone === "success"
              ? "border-success/30 bg-success-dim text-success"
              : "border-danger/30 bg-danger-dim text-danger"
          }`}
        >
          {banner.message}
        </div>
      )}

      <Panel>
        <PanelHeader title={t.nicheDetail.connectionsPanel.title} description={t.nicheDetail.connectionsPanel.description} />
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
                    {connectionStatusLabel(t.connectionStatus, platform, status)}
                  </Badge>
                </div>

                <div className="flex gap-2">
                  {status === "disconnected" && (
                    <>
                      <ButtonLink href={`/api/auth/${platform}/authorize?nicheId=${id}`} variant="secondary" size="sm">
                        {t.nicheDetail.connectViaOAuth}
                      </ButtonLink>
                      <ConnectionStatusButton
                        nicheId={id}
                        platform={platform}
                        status="pending_review"
                        label={t.nicheDetail.markSubmitted}
                      />
                    </>
                  )}
                  {status === "pending_review" && (
                    <>
                      <ConnectionStatusButton
                        nicheId={id}
                        platform={platform}
                        status="active"
                        label={t.nicheDetail.markActive}
                        variant="primary"
                      />
                      <ConnectionStatusButton
                        nicheId={id}
                        platform={platform}
                        status="disconnected"
                        label={t.nicheDetail.reset}
                      />
                    </>
                  )}
                  {status === "active" && (
                    <ConnectionStatusButton
                      nicheId={id}
                      platform={platform}
                      status="disconnected"
                      label={t.nicheDetail.disconnect}
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
          title={t.nicheDetail.ideasPanel.title}
          description={t.nicheDetail.ideasPanel.description}
          action={
            <form action={generateIdeasAction.bind(null, id)}>
              <Button type="submit" variant="primary">
                ✦ {t.nicheDetail.generateIdeas}
              </Button>
            </form>
          }
        />
        <div className="px-6 py-6">
          {pendingIdeas.length > 0 ? (
            <ButtonLink href={`/niches/${id}/ideas`} variant="secondary" className="w-full py-4">
              {t.nicheDetail.reviewIdeasCta(pendingIdeas.length)}
            </ButtonLink>
          ) : (
            <p className="text-sm text-fg-subtle">{t.nicheDetail.noIdeasPending}</p>
          )}
        </div>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title={t.nicheDetail.jobsPanel.title} description={t.nicheDetail.jobsPanel.description} />
        <div className="px-6 py-6">
          {generationJobs.length > 0 ? (
            <ul className="space-y-3">
              {generationJobs.map(({ job, ideaTitle, providerName }) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-ink-900/50 px-4 py-3.5"
                >
                  <div>
                    <div className="text-sm font-medium">{ideaTitle}</div>
                    <div className="mt-1 text-xs text-fg-subtle">
                      {providerName} · {t.nicheDetail.attempt(job.attemptCount)}
                      {job.lastError ? ` · ${job.lastError}` : ""}
                    </div>
                  </div>
                  <Badge tone={JOB_STATUS_TONES[job.status] ?? "idle"}>
                    {t.status.job[job.status as keyof typeof t.status.job] ?? job.status}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-subtle">{t.nicheDetail.noJobsYet}</p>
          )}
        </div>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title={t.nicheDetail.videosPanel.title} description={t.nicheDetail.videosPanel.description} />
        <div className="px-6 py-6">
          {pendingVideos.length > 0 ? (
            <ButtonLink href={`/niches/${id}/videos`} variant="secondary" className="w-full py-4">
              {t.nicheDetail.reviewVideosCta(pendingVideos.length)}
            </ButtonLink>
          ) : (
            <p className="text-sm text-fg-subtle">{t.nicheDetail.noVideosPending}</p>
          )}
        </div>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title={t.nicheDetail.schedulePanel.title} description={t.nicheDetail.schedulePanel.description} />
        <div className="px-6 py-6">
          {readyVideos.length > 0 ? (
            <ButtonLink href={`/niches/${id}/schedule`} variant="secondary" className="w-full py-4">
              {t.nicheDetail.scheduleVideosCta(readyVideos.length)}
            </ButtonLink>
          ) : (
            <p className="text-sm text-fg-subtle">{t.nicheDetail.noVideosReady}</p>
          )}
        </div>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title={t.nicheDetail.settingsPanel.title} />
        <div className="px-6 py-6">
          <NicheFormFields
            action={updateNicheAction.bind(null, id)}
            providers={providers}
            submitLabel={t.nicheForm.saveChanges}
            dict={t.nicheForm}
            defaults={{
              name: niche.name,
              themeGuidance: niche.themeGuidance,
              referenceGuidance: niche.referenceGuidance,
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
