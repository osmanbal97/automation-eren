import type { NicheGenerationSpecs, TargetPostsPerDay } from "@/actions/niches";
import type { videoProviders } from "@/db/schema";

type Provider = typeof videoProviders.$inferSelect;

const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;

const inputClass =
  "mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500";

export function NicheFormFields({
  action,
  providers,
  submitLabel,
  defaults,
}: {
  action: (formData: FormData) => Promise<void>;
  providers: Provider[];
  submitLabel: string;
  defaults?: {
    name: string;
    themeGuidance: string;
    targetPostsPerDay: TargetPostsPerDay;
    defaultProviderId: string | null;
    defaultGenerationSpecs: NicheGenerationSpecs;
  };
}) {
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-neutral-300">Name</label>
        <input name="name" required defaultValue={defaults?.name} className={inputClass} />
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-300">Theme guidance</label>
        <textarea
          name="themeGuidance"
          required
          rows={3}
          defaultValue={defaults?.themeGuidance}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {PLATFORMS.map((platform) => (
          <div key={platform}>
            <label className="block text-sm font-medium capitalize text-neutral-300">
              {platform} posts/day
            </label>
            <input
              type="number"
              min={0}
              name={`${platform}PerDay`}
              defaultValue={defaults?.targetPostsPerDay[platform] ?? 0}
              className={inputClass}
            />
          </div>
        ))}
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-300">Default provider</label>
        <select
          name="defaultProviderId"
          defaultValue={defaults?.defaultProviderId ?? ""}
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
            defaultValue={defaults?.defaultGenerationSpecs.resolution ?? "1080x1920"}
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
            defaultValue={defaults?.defaultGenerationSpecs.durationSeconds ?? 8}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-300">Aspect ratio</label>
          <input
            name="aspectRatio"
            required
            defaultValue={defaults?.defaultGenerationSpecs.aspectRatio ?? "9:16"}
            className={inputClass}
          />
        </div>
      </div>

      <button
        type="submit"
        className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-white"
      >
        {submitLabel}
      </button>
    </form>
  );
}
