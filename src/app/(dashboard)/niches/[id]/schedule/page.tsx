import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getNiche } from "@/actions/niches";
import { ActionNotFoundError } from "@/actions/errors";
import { getDb } from "@/db/client";
import { ideas, scheduledPosts, videos } from "@/db/schema";
import { EmptyState, PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { ScheduleCard } from "./ScheduleCard";

export const dynamic = "force-dynamic";

/** Scheduling calendar/list (US-019): every ready_to_schedule video for one niche, each
 * with whatever scheduled_posts it already has plus a form to book more -- one
 * scheduled_posts row per platform, validated against the niche's per-platform daily
 * cap (niches.targetPostsPerDay) by the schedulePost action. */
export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale } = await getT();
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

  const rows = await db
    .select({ video: videos, ideaTitle: ideas.title })
    .from(videos)
    .innerJoin(ideas, eq(videos.ideaId, ideas.id))
    .where(and(eq(videos.nicheId, id), eq(videos.status, "ready_to_schedule")))
    .orderBy(desc(videos.createdAt));

  const videoIds = rows.map(({ video }) => video.id);
  const existingPosts =
    videoIds.length > 0
      ? await db
          .select()
          .from(scheduledPosts)
          .where(inArray(scheduledPosts.videoId, videoIds))
          .orderBy(scheduledPosts.scheduledAt)
      : [];
  const postsByVideo = new Map<string, (typeof existingPosts)[number][]>();
  for (const post of existingPosts) {
    const list = postsByVideo.get(post.videoId) ?? [];
    list.push(post);
    postsByVideo.set(post.videoId, list);
  }

  return (
    <>
      <Link href={`/niches/${id}`} className="text-sm text-fg-muted transition hover:text-fg">
        ← {niche.name}
      </Link>

      <div className="mt-3">
        <PageHeader
          eyebrow={t.schedule.eyebrow}
          title={t.schedule.title}
          description={t.schedule.readyDescription(rows.length)}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t.schedule.emptyTitle}>
          {t.schedule.emptyBodyPrefix}{" "}
          <Link href={`/niches/${id}/videos`} className="text-accent-violet hover:underline">
            {t.schedule.emptyBodyLink}
          </Link>{" "}
          {t.schedule.emptyBodySuffix}
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {rows.map(({ video, ideaTitle }) => (
            <ScheduleCard
              key={video.id}
              video={video}
              ideaTitle={ideaTitle}
              nicheId={id}
              existingPosts={postsByVideo.get(video.id) ?? []}
              dict={t.schedule}
              statusDict={t.status.post}
              locale={locale}
            />
          ))}
        </div>
      )}
    </>
  );
}
