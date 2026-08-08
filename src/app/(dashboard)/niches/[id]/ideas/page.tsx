import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getNiche } from "@/actions/niches";
import { ActionNotFoundError } from "@/actions/errors";
import { getDb } from "@/db/client";
import { ideas, videoProviders } from "@/db/schema";
import { EmptyState, PageHeader } from "@/components/ui";
import { IdeaReviewCard } from "./IdeaReviewCard";

export const dynamic = "force-dynamic";

/** Idea review queue (US-012): every pending_review idea for one niche, with inline
 * edit for prompt/caption, a provider/specs picker showing a live cost estimate, and
 * Approve/Reject -- all backed by the US-005 shared action layer. */
export default async function IdeaReviewPage({ params }: { params: Promise<{ id: string }> }) {
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
          eyebrow="Review queue"
          title="Ideas"
          description={`${pendingIdeas.length} idea${pendingIdeas.length === 1 ? "" : "s"} pending review. Tune the prompt — or let Claude optimize it — before approving.`}
        />
      </div>

      {pendingIdeas.length === 0 ? (
        <EmptyState title="Queue is clear">
          Generate more from the{" "}
          <Link href={`/niches/${id}`} className="text-accent-violet hover:underline">
            niche page
          </Link>
          .
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {pendingIdeas.map((idea) => (
            <IdeaReviewCard key={idea.id} idea={idea} nicheId={id} providers={providers} />
          ))}
        </div>
      )}
    </>
  );
}
