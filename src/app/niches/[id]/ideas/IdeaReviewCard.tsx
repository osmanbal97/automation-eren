"use client";

import { useMemo, useState } from "react";
import type { ideas, videoProviders } from "@/db/schema";
import { estimateCost } from "@/lib/cost-estimator";
import { approveIdeaAction, rejectIdeaAction, updateIdeaAction } from "./actions";

type Idea = typeof ideas.$inferSelect;
type Provider = typeof videoProviders.$inferSelect;

interface GenerationSpecsShape {
  resolution?: string;
  durationSeconds?: number;
  aspectRatio?: string;
}

const inputClass =
  "mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500";

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
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{idea.title}</h3>
          <p className="mt-1 text-sm text-neutral-400">{idea.concept}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <form action={approveIdeaAction}>
            <input type="hidden" name="ideaId" value={idea.id} />
            <input type="hidden" name="nicheId" value={nicheId} />
            <button
              type="submit"
              className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-500"
            >
              Approve
            </button>
          </form>
          <form action={rejectIdeaAction}>
            <input type="hidden" name="ideaId" value={idea.id} />
            <input type="hidden" name="nicheId" value={nicheId} />
            <button
              type="submit"
              className="rounded-md border border-red-800 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:border-red-600"
            >
              Reject
            </button>
          </form>
        </div>
      </div>

      <form action={updateIdeaAction} className="mt-4 space-y-3">
        <input type="hidden" name="ideaId" value={idea.id} />
        <input type="hidden" name="nicheId" value={nicheId} />

        <div>
          <label className="block text-sm font-medium text-neutral-300">Prompt</label>
          <textarea name="prompt" required rows={3} defaultValue={idea.prompt} className={inputClass} />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-300">Caption</label>
          <textarea name="caption" required rows={2} defaultValue={idea.caption} className={inputClass} />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-300">Provider</label>
          <select
            name="providerId"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            className={inputClass}
          >
            <option value="">None</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-neutral-300">Resolution</label>
            <input
              name="resolution"
              required
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-300">Duration (s)</label>
            <input
              type="number"
              min={1}
              name="durationSeconds"
              required
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(Number(event.target.value))}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-300">Aspect ratio</label>
            <input
              name="aspectRatio"
              required
              value={aspectRatio}
              onChange={(event) => setAspectRatio(event.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-sm text-neutral-400">
            Estimated cost:{" "}
            <span className="font-medium text-neutral-100">
              {liveEstimate !== null ? `$${liveEstimate.toFixed(4)}` : "— (pick a provider)"}
            </span>
          </p>
          <button
            type="submit"
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-white"
          >
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
}
