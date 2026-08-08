import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getNiche } from "@/actions/niches";
import { ActionNotFoundError } from "@/actions/errors";
import { getDb } from "@/db/client";
import { ideas, videoProviders } from "@/db/schema";
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
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-2xl">
        <Link href={`/niches/${id}`} className="text-sm text-neutral-400 hover:underline">
          &larr; {niche.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Review ideas</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {pendingIdeas.length} idea{pendingIdeas.length === 1 ? "" : "s"} pending review.
        </p>

        {pendingIdeas.length === 0 ? (
          <p className="mt-6 text-sm text-neutral-500">
            No ideas pending review. Generate some from the{" "}
            <Link href={`/niches/${id}`} className="underline">
              niche page
            </Link>
            .
          </p>
        ) : (
          <div className="mt-6 space-y-4">
            {pendingIdeas.map((idea) => (
              <IdeaReviewCard key={idea.id} idea={idea} nicheId={id} providers={providers} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
