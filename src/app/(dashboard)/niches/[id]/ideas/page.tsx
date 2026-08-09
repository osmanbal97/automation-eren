import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getNiche } from "@/actions/niches";
import { ActionNotFoundError } from "@/actions/errors";
import { getDb } from "@/db/client";
import { ideas, videoProviders } from "@/db/schema";
import { EmptyState, PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { IdeaReviewCard } from "./IdeaReviewCard";

export const dynamic = "force-dynamic";

/** Idea review queue (US-012): every pending_review idea for one niche, with inline
 * edit for prompt/caption, a provider/specs picker showing a live cost estimate, and
 * Approve/Reject -- all backed by the US-005 shared action layer. */
export default async function IdeaReviewPage({ params }: { params: Promise<{ id: string }> }) {
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

  const [providers, pendingIdeas] = await Promise.all([
    db.select().from(videoProviders).where(eq(videoProviders.enabled, true)).orderBy(asc(videoProviders.name)),
    db
      .select()
      .from(ideas)
      .where(and(eq(ideas.nicheId, id), eq(ideas.status, "pending_review")))
      .orderBy(desc(ideas.createdAt)),
  ]);

  return (
    <>
      <Link href={`/niches/${id}`} className="text-sm text-fg-muted transition hover:text-fg">
        ← {niche.name}
      </Link>

      <div className="mt-3">
        <PageHeader
          eyebrow={t.ideas.eyebrow}
          title={t.ideas.title}
          description={t.ideas.pendingDescription(pendingIdeas.length)}
        />
      </div>

      {pendingIdeas.length === 0 ? (
        <EmptyState title={t.ideas.emptyTitle}>
          {t.ideas.emptyBodyPrefix}{" "}
          <Link href={`/niches/${id}`} className="text-accent-violet hover:underline">
            {t.ideas.emptyBodyLink}
          </Link>
          {t.ideas.emptyBodySuffix}
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {pendingIdeas.map((idea) => (
            <IdeaReviewCard key={idea.id} idea={idea} nicheId={id} providers={providers} dict={t.ideas} />
          ))}
        </div>
      )}
    </>
  );
}
