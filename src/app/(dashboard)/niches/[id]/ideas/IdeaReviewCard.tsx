"use client";

import { useMemo, useState } from "react";
import type { ideas, videoProviders } from "@/db/schema";
import { estimateCost } from "@/lib/cost-estimator";
import { Button, Field, Input, Panel, Select, Textarea } from "@/components/ui";
import { approveIdeaAction, rejectIdeaAction, updateIdeaAction } from "./actions";

type Idea = typeof ideas.$inferSelect;
type Provider = typeof videoProviders.$inferSelect;

interface GenerationSpecsShape {
  resolution?: string;
  durationSeconds?: number;
  aspectRatio?: string;
}

/** Review-queue card for one pending idea (US-012): inline edit for prompt/caption, a
 * provider/specs picker with a live-updated cost estimate, and Approve/Reject -- all
 * wired to the US-005 shared action layer via the server actions in ./actions.ts. */
export function IdeaReviewCard({ idea, nicheId, providers }: { idea: Idea; nicheId: string; providers: Provider[] }) {
  const specs = (idea.generationSpecs as GenerationSpecsShape | null) ?? {};
  const [providerId, setProviderId] = useState(idea.providerId ?? "");
  const [resolution, setResolution] = useState(specs.resolution ?? "1080x1920");
  const [durationSeconds, setDurationSeconds] = useState(specs.durationSeconds ?? 8);
  const [aspectRatio, setAspectRatio] = useState(specs.aspectRatio ?? "9:16");

  const liveEstimate = useMemo(() => {
    const provider = providers.find((candidate) => candidate.id === providerId);
    if (!provider || !durationSeconds || durationSeconds <= 0) {
      return null;
    }
    const currentSpecs = { resolution, durationSeconds, aspectRatio };
    return estimateCost(provider, currentSpecs);
  }, [providers, providerId, resolution, durationSeconds, aspectRatio]);

  return (
    <Panel className="animate-rise overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight">{idea.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{idea.concept}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <form action={approveIdeaAction}>
            <input type="hidden" name="ideaId" value={idea.id} />
            <input type="hidden" name="nicheId" value={nicheId} />
            <Button type="submit" variant="primary" size="sm">
              ✓ Approve
            </Button>
          </form>
          <form action={rejectIdeaAction}>
            <input type="hidden" name="ideaId" value={idea.id} />
            <input type="hidden" name="nicheId" value={nicheId} />
            <Button type="submit" variant="danger" size="sm">
              Reject
            </Button>
          </form>
        </div>
      </div>

      <form action={updateIdeaAction} className="space-y-5 px-6 py-6">
        <input type="hidden" name="ideaId" value={idea.id} />
        <input type="hidden" name="nicheId" value={nicheId} />

        <Field label="Prompt">
          <Textarea name="prompt" required rows={3} defaultValue={idea.prompt} />
        </Field>

        <Field label="Caption">
          <Textarea name="caption" required rows={2} defaultValue={idea.caption} />
        </Field>

        <Field label="Provider">
          <Select
            name="providerId"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          >
            <option value="">None</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Resolution">
            <Input
              name="resolution"
              required
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
            />
          </Field>
          <Field label="Duration (s)">
            <Input
              type="number"
              min={1}
              name="durationSeconds"
              required
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(Number(event.target.value))}
            />
          </Field>
          <Field label="Aspect ratio">
            <Input
              name="aspectRatio"
              required
              value={aspectRatio}
              onChange={(event) => setAspectRatio(event.target.value)}
            />
          </Field>
        </div>

        <div className="-mx-6 -mb-6 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-ink-900/40 px-6 py-4">
          <p className="text-sm text-fg-muted">
            Estimated cost{" "}
            <span className="ml-1 text-base font-semibold tabular-nums text-fg">
              {liveEstimate !== null ? `$${liveEstimate.toFixed(4)}` : "—"}
            </span>
            {liveEstimate === null ? (
              <span className="ml-2 text-xs text-fg-subtle">pick a provider</span>
            ) : null}
          </p>
          <Button type="submit" variant="secondary">
            Save changes
          </Button>
        </div>
      </form>
    </Panel>
  );
}
