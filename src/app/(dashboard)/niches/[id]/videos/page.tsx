import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getNiche } from "@/actions/niches";
import { ActionNotFoundError } from "@/actions/errors";
import { getDb } from "@/db/client";
import { ideas, videos } from "@/db/schema";
import { EmptyState, PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { VideoReviewCard } from "./VideoReviewCard";

export const dynamic = "force-dynamic";

/** Video review queue (US-018): every pending_review video for one niche, with a
 * preview, caption/hashtag editing, Approve/Reject, and a Regenerate flow (edit the
 * prompt or have Claude optimize it, then re-queue generation) -- all backed by the
 * US-005 shared action layer, mirroring the ideas review queue. */
export default async function VideoReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
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
    .select({ video: videos, ideaTitle: ideas.title, ideaPrompt: ideas.prompt })
    .from(videos)
    .innerJoin(ideas, eq(videos.ideaId, ideas.id))
    .where(and(eq(videos.nicheId, id), eq(videos.status, "pending_review")))
    .orderBy(desc(videos.createdAt));

  return (
    <>
      <Link href={`/niches/${id}`} className="text-sm text-fg-muted transition hover:text-fg">
        ← {niche.name}
      </Link>

      <div className="mt-3">
        <PageHeader
          eyebrow={t.videos.eyebrow}
          title={t.videos.title}
          description={t.videos.pendingDescription(rows.length)}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t.videos.emptyTitle}>
          {t.videos.emptyBodyPrefix}{" "}
          <Link href={`/niches/${id}/ideas`} className="text-accent-violet hover:underline">
            {t.videos.emptyBodyLink}
          </Link>{" "}
          {t.videos.emptyBodySuffix}
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {rows.map(({ video, ideaTitle, ideaPrompt }) => (
            <VideoReviewCard
              key={video.id}
              video={video}
              ideaTitle={ideaTitle}
              ideaPrompt={ideaPrompt}
              nicheId={id}
              dict={t.videos}
            />
          ))}
        </div>
      )}
    </>
  );
}
