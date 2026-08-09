"use client";

import { useState } from "react";
import type { ideas, videos } from "@/db/schema";
import { Button, Field, Input, Panel, Textarea } from "@/components/ui";
import type { Dictionary } from "@/lib/i18n";
import {
  approveVideoAction,
  regenerateWithEditedPromptAction,
  regenerateWithOptimizedPromptAction,
  rejectVideoAction,
  updateVideoAction,
} from "./actions";

type Video = typeof videos.$inferSelect;
type Idea = typeof ideas.$inferSelect;

/** Review-queue card for one pending video (US-018): a preview player, inline
 * caption/hashtag editing, Approve/Reject, and a collapsible Regenerate panel offering
 * either an edited prompt or a Claude-optimized rewrite -- mirroring the ideas review
 * queue's card, wired to the ./actions.ts server actions. */
export function VideoReviewCard({
  video,
  ideaTitle,
  ideaPrompt,
  nicheId,
  dict,
}: {
  video: Video;
  ideaTitle: string;
  ideaPrompt: Idea["prompt"];
  nicheId: string;
  dict: Dictionary["videos"];
}) {
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const hashtags = Array.isArray(video.hashtags) ? (video.hashtags as string[]) : [];

  return (
    <Panel className="animate-rise overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight">{ideaTitle}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{video.caption}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <form action={approveVideoAction}>
            <input type="hidden" name="videoId" value={video.id} />
            <input type="hidden" name="nicheId" value={nicheId} />
            <Button type="submit" variant="primary" size="sm">
              ✓ {dict.approve}
            </Button>
          </form>
          <form action={rejectVideoAction}>
            <input type="hidden" name="videoId" value={video.id} />
            <input type="hidden" name="nicheId" value={nicheId} />
            <Button type="submit" variant="danger" size="sm">
              {dict.reject}
            </Button>
          </form>
        </div>
      </div>

      <div className="border-b border-line bg-ink-900/30 px-6 py-5">
        <video
          controls
          preload="metadata"
          poster={video.thumbnailBlobUrl ?? undefined}
          src={video.blobUrl}
          className="max-h-96 w-full rounded-lg bg-black"
        />
      </div>

      <form action={updateVideoAction} className="space-y-5 px-6 py-6">
        <input type="hidden" name="videoId" value={video.id} />
        <input type="hidden" name="nicheId" value={nicheId} />

        <Field label={dict.captionLabel}>
          <Textarea name="caption" required rows={2} defaultValue={video.caption} />
        </Field>

        <Field label={dict.hashtagsLabel}>
          <Input name="hashtags" defaultValue={hashtags.join(", ")} placeholder={dict.hashtagsPlaceholder} />
        </Field>

        <div className="flex justify-end">
          <Button type="submit" variant="secondary">
            {dict.saveChanges}
          </Button>
        </div>
      </form>

      <div className="border-t border-line">
        <button
          type="button"
          onClick={() => setRegenerateOpen((open) => !open)}
          className="flex w-full items-center justify-between px-6 py-3.5 text-left text-xs font-medium tracking-wide text-fg-subtle uppercase transition hover:text-fg"
        >
          <span>🔁 {dict.regenerateToggle}</span>
          <span>{regenerateOpen ? "−" : "+"}</span>
        </button>

        {regenerateOpen ? (
          <div className="space-y-4 border-t border-line bg-ink-900/30 px-6 py-5">
            <form action={regenerateWithEditedPromptAction} className="space-y-3">
              <input type="hidden" name="ideaId" value={video.ideaId} />
              <input type="hidden" name="nicheId" value={nicheId} />
              <Field label={dict.regenerateEditedLabel}>
                <Textarea name="prompt" required rows={3} defaultValue={ideaPrompt} />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" variant="secondary" size="sm">
                  {dict.regenerateButton}
                </Button>
              </div>
            </form>

            <form
              action={regenerateWithOptimizedPromptAction}
              className="flex flex-wrap items-center gap-2 border-t border-line pt-4"
            >
              <input type="hidden" name="ideaId" value={video.ideaId} />
              <input type="hidden" name="nicheId" value={nicheId} />
              <span className="shrink-0 text-xs font-medium tracking-wide text-fg-subtle uppercase">
                ✨ {dict.optimizeLabel}
              </span>
              <Input name="note" placeholder={dict.optimizePlaceholder} className="min-w-[10rem] flex-1" />
              <Button type="submit" variant="secondary" size="sm" className="shrink-0">
                {dict.optimizeRegenerateButton}
              </Button>
            </form>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
