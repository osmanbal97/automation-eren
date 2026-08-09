import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { niches, platformEnum, scheduledPostStatusEnum, scheduledPosts, videos, publishJobs } from "@/db/schema";
import { Badge, type BadgeTone, Button, EmptyState, PageHeader, Panel, Select } from "@/components/ui";
import { getT, toBcp47 } from "@/lib/i18n";
import { retryPublishAction } from "./actions";

export const dynamic = "force-dynamic";

const PLATFORMS = platformEnum.enumValues;
const STATUSES = scheduledPostStatusEnum.enumValues;

const STATUS_TONES: Record<string, BadgeTone> = {
  scheduled: "pending",
  awaiting_platform_approval: "pending",
  publishing: "pending",
  published: "success",
  failed: "danger",
};

/** History dashboard (US-025): every scheduled_posts row, newest-scheduled-first,
 * filterable by niche/platform/status. Failed posts show the last publish_jobs error
 * plus a manual "Retry now" button wired straight into publishScheduledPost via
 * ./actions.ts's retryPublishAction -- the same action layer the cron worker uses. */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ niche?: string; platform?: string; status?: string }>;
}) {
  const { t, locale } = await getT();
  const { niche: nicheFilter, platform: platformFilter, status: statusFilter } = await searchParams;
  const db = getDb();

  const allNiches = await db.select({ id: niches.id, name: niches.name }).from(niches).orderBy(niches.name);

  const conditions = [
    nicheFilter ? eq(scheduledPosts.nicheId, nicheFilter) : undefined,
    platformFilter ? eq(scheduledPosts.platform, platformFilter as (typeof PLATFORMS)[number]) : undefined,
    statusFilter ? eq(scheduledPosts.status, statusFilter as (typeof STATUSES)[number]) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await db
    .select({ post: scheduledPosts, video: videos, nicheName: niches.name })
    .from(scheduledPosts)
    .innerJoin(videos, eq(scheduledPosts.videoId, videos.id))
    .innerJoin(niches, eq(scheduledPosts.nicheId, niches.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(scheduledPosts.scheduledAt));

  const postIds = rows.map(({ post }) => post.id);
  const jobs =
    postIds.length > 0
      ? await db
          .select()
          .from(publishJobs)
          .where(inArray(publishJobs.scheduledPostId, postIds))
          .orderBy(desc(publishJobs.createdAt))
      : [];
  const latestJobByPost = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) {
    if (!latestJobByPost.has(job.scheduledPostId)) {
      latestJobByPost.set(job.scheduledPostId, job);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={t.history.eyebrow}
        title={t.history.title}
        description={t.history.description}
      />

      <Panel className="mb-6 p-5">
        <form className="flex flex-wrap items-end gap-4" method="get">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-fg-muted uppercase">
              {t.history.nicheLabel}
            </span>
            <Select name="niche" defaultValue={nicheFilter ?? ""} className="min-w-40">
              <option value="">{t.history.allNiches}</option>
              {allNiches.map((niche) => (
                <option key={niche.id} value={niche.id}>
                  {niche.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-fg-muted uppercase">
              {t.history.platformLabel}
            </span>
            <Select name="platform" defaultValue={platformFilter ?? ""} className="min-w-36 capitalize">
              <option value="">{t.history.allPlatforms}</option>
              {PLATFORMS.map((platform) => (
                <option key={platform} value={platform} className="capitalize">
                  {platform}
                </option>
              ))}
            </Select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-fg-muted uppercase">
              {t.history.statusLabel}
            </span>
            <Select name="status" defaultValue={statusFilter ?? ""} className="min-w-44">
              <option value="">{t.history.allStatuses}</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t.status.post[status as keyof typeof t.status.post] ?? status}
                </option>
              ))}
            </Select>
          </label>

          <Button type="submit" variant="secondary" size="sm">
            {t.history.filter}
          </Button>
        </form>
      </Panel>

      {rows.length === 0 ? (
        <EmptyState title={t.history.emptyTitle}>{t.history.emptyBody}</EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map(({ post, video, nicheName }) => {
            const job = latestJobByPost.get(post.id);
            return (
              <Panel key={post.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{nicheName}</span>
                    <Badge tone="idle" className="capitalize">
                      {post.platform}
                    </Badge>
                    <Badge tone={STATUS_TONES[post.status] ?? "idle"}>
                      {t.status.post[post.status as keyof typeof t.status.post] ?? post.status}
                    </Badge>
                  </div>
                  <p className="mt-1.5 max-w-2xl truncate text-sm text-fg-muted">{video.caption}</p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    {t.history.scheduledFor(new Date(post.scheduledAt).toLocaleString(toBcp47(locale)))}
                    {job?.platformPostId ? ` · ${t.history.platformPost(job.platformPostId)}` : ""}
                  </p>
                  {post.status === "failed" && job?.lastError ? (
                    <p className="mt-1.5 text-xs text-danger">{job.lastError}</p>
                  ) : null}
                </div>

                {post.status === "failed" ? (
                  <form action={retryPublishAction.bind(null, post.id)}>
                    <Button type="submit" variant="secondary" size="sm">
                      {t.history.retryNow}
                    </Button>
                  </form>
                ) : null}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
