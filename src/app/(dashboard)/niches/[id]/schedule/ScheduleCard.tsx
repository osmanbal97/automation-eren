"use client";

import type { scheduledPosts, videos } from "@/db/schema";
import { Badge, type BadgeTone, Button, Field, Input, Panel } from "@/components/ui";
import { scheduleVideoAction } from "./actions";

type Video = typeof videos.$inferSelect;
type ScheduledPost = typeof scheduledPosts.$inferSelect;

const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;

const POST_STATUS_TONES: Record<string, BadgeTone> = {
  scheduled: "pending",
  awaiting_platform_approval: "pending",
  publishing: "pending",
  published: "success",
  failed: "danger",
};

/** One ready_to_schedule video's card (US-019): lists any platform+time slots it
 * already has booked, then a form to book more -- checkboxes for platform(s) plus one
 * shared datetime, submitted to ./actions.ts's scheduleVideoAction, which enforces the
 * niche's per-platform daily cap and creates one scheduled_posts row per checked
 * platform. */
export function ScheduleCard({
  video,
  ideaTitle,
  nicheId,
  existingPosts,
}: {
  video: Video;
  ideaTitle: string;
  nicheId: string;
  existingPosts: ScheduledPost[];
}) {
  return (
    <Panel className="animate-rise overflow-hidden">
      <div className="border-b border-line px-6 py-5">
        <h3 className="text-base font-semibold tracking-tight">{ideaTitle}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{video.caption}</p>
      </div>

      {existingPosts.length > 0 ? (
        <ul className="space-y-2 border-b border-line bg-ink-900/30 px-6 py-4">
          {existingPosts.map((post) => (
            <li key={post.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-fg-muted capitalize">
                {post.platform} · {new Date(post.scheduledAt).toLocaleString()}
              </span>
              <Badge tone={POST_STATUS_TONES[post.status] ?? "idle"}>{post.status.replaceAll("_", " ")}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      <form action={scheduleVideoAction} className="space-y-4 px-6 py-6">
        <input type="hidden" name="videoId" value={video.id} />
        <input type="hidden" name="nicheId" value={nicheId} />

        <div>
          <span className="mb-1.5 block text-xs font-medium tracking-wide text-fg-muted uppercase">
            Platforms
          </span>
          <div className="flex flex-wrap gap-4">
            {PLATFORMS.map((platform) => (
              <label key={platform} className="flex items-center gap-2 text-sm capitalize">
                <input
                  type="checkbox"
                  name="platforms"
                  value={platform}
                  className="size-4 rounded border-line bg-ink-900/70 accent-accent-violet"
                />
                {platform}
              </label>
            ))}
          </div>
        </div>

        <Field label="When" hint="Interpreted in the server's local time zone.">
          <Input type="datetime-local" name="scheduledAt" required />
        </Field>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="sm">
            Schedule
          </Button>
        </div>
      </form>
    </Panel>
  );
}
