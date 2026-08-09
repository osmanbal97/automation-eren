import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { niches, platformEnum, scheduledPostStatusEnum, scheduledPosts, videos, publishJobs } from "@/db/schema";
import { Badge, type BadgeTone, Button, EmptyState, PageHeader, Panel, Select } from "@/components/ui";
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
        eyebrow="Publishing"
        title="History"
        description="Every scheduled post, newest first — what went out, what's pending, and what failed."
      />

      <Panel className="mb-6 p-5">
        <form className="flex flex-wrap items-end gap-4" method="get">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-fg-muted uppercase">
              Niche
            </span>
            <Select name="niche" defaultValue={nicheFilter ?? ""} className="min-w-40">
              <option value="">All niches</option>
              {allNiches.map((niche) => (
                <option key={niche.id} value={niche.id}>
                  {niche.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-fg-muted uppercase">
              Platform
            </span>
            <Select name="platform" defaultValue={platformFilter ?? ""} className="min-w-36 capitalize">
              <option value="">All platforms</option>
              {PLATFORMS.map((platform) => (
                <option key={platform} value={platform} className="capitalize">
                  {platform}
                </option>
              ))}
            </Select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-fg-muted uppercase">
              Status
            </span>
            <Select name="status" defaultValue={statusFilter ?? ""} className="min-w-44">
              <option value="">All statuses</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </label>

          <Button type="submit" variant="secondary" size="sm">
            Filter
          </Button>
        </form>
      </Panel>

      {rows.length === 0 ? (
        <EmptyState title="No scheduled posts match these filters">
          Try widening the filters above, or schedule a video from a niche&apos;s schedule page.
        </EmptyState>
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
                    <Badge tone={STATUS_TONES[post.status] ?? "idle"}>{post.status.replaceAll("_", " ")}</Badge>
                  </div>
                  <p className="mt-1.5 max-w-2xl truncate text-sm text-fg-muted">{video.caption}</p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Scheduled for {new Date(post.scheduledAt).toLocaleString()}
                    {job?.platformPostId ? ` · platform post ${job.platformPostId}` : ""}
                  </p>
                  {post.status === "failed" && job?.lastError ? (
                    <p className="mt-1.5 text-xs text-danger">{job.lastError}</p>
                  ) : null}
                </div>

                {post.status === "failed" ? (
                  <form action={retryPublishAction.bind(null, post.id)}>
                    <Button type="submit" variant="secondary" size="sm">
                      Retry now
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
