import type { NicheGenerationSpecs, TargetPostsPerDay } from "@/actions/niches";
import type { videoProviders } from "@/db/schema";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { Dictionary } from "@/lib/i18n";

type Provider = typeof videoProviders.$inferSelect;

const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;

/** Fixed option sets so these fields are combo boxes, not free typing. Common short-form
 * video presets -- not exhaustive of what every provider supports (GenerationSpecs.resolution
 * is deliberately loose per-provider), so the current stored value is always included as an
 * extra option below if it isn't already one of these, rather than silently discarded. */
const RESOLUTION_OPTIONS = ["1080x1920", "1920x1080", "1080x1080", "1440x1920", "720x1280"];
const ASPECT_RATIO_OPTIONS = ["9:16", "16:9", "1:1", "4:5"];
const DURATION_OPTIONS = [5, 8, 10, 15, 20, 30, 60];
const PER_DAY_OPTIONS = Array.from({ length: 11 }, (_, i) => i); // 0..10

/** Ensures `current` is selectable even if it isn't one of the presets (e.g. a value set
 * before these became comboboxes, or a value outside the common list), so saving the form
 * without touching the field never overwrites it with a different one. */
function withCurrent<T extends string | number>(options: T[], current: T | undefined): T[] {
  if (current === undefined || options.includes(current)) return options;
  return [current, ...options];
}

export function NicheFormFields({
  action,
  providers,
  submitLabel,
  dict,
  defaults,
}: {
  action: (formData: FormData) => Promise<void>;
  providers: Provider[];
  submitLabel: string;
  dict: Dictionary["nicheForm"];
  defaults?: {
    name: string;
    themeGuidance: string;
    referenceGuidance?: string | null;
    targetPostsPerDay: TargetPostsPerDay;
    defaultProviderId: string | null;
    defaultGenerationSpecs: NicheGenerationSpecs;
  };
}) {
  const resolutionOptions = withCurrent(RESOLUTION_OPTIONS, defaults?.defaultGenerationSpecs.resolution);
  const aspectRatioOptions = withCurrent(ASPECT_RATIO_OPTIONS, defaults?.defaultGenerationSpecs.aspectRatio);
  const durationOptions = withCurrent(DURATION_OPTIONS, defaults?.defaultGenerationSpecs.durationSeconds);

  return (
    <form action={action} className="space-y-5">
      <Field label={dict.nameLabel}>
        <Input name="name" required defaultValue={defaults?.name} placeholder={dict.namePlaceholder} />
      </Field>

      <Field label={dict.themeGuidanceLabel} hint={dict.themeGuidanceHint}>
        <Textarea
          name="themeGuidance"
          required
          rows={3}
          defaultValue={defaults?.themeGuidance}
          placeholder={dict.themeGuidancePlaceholder}
        />
      </Field>

      <Field label={dict.referenceGuidanceLabel} hint={dict.referenceGuidanceHint}>
        <Textarea
          name="referenceGuidance"
          rows={3}
          defaultValue={defaults?.referenceGuidance ?? ""}
          placeholder={dict.referenceGuidancePlaceholder}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        {PLATFORMS.map((platform) => {
          const current = defaults?.targetPostsPerDay[platform] ?? 0;
          return (
            <Field key={platform} label={dict.perDayLabel(platform)}>
              <Select name={`${platform}PerDay`} defaultValue={String(current)}>
                {withCurrent(PER_DAY_OPTIONS, current).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
          );
        })}
      </div>

      <Field label={dict.defaultProviderLabel}>
        <Select name="defaultProviderId" defaultValue={defaults?.defaultProviderId ?? ""}>
          <option value="">{dict.none}</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={dict.resolutionLabel}>
          <Select name="resolution" defaultValue={defaults?.defaultGenerationSpecs.resolution ?? "1080x1920"}>
            {resolutionOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={dict.durationLabel}>
          <Select
            name="durationSeconds"
            defaultValue={String(defaults?.defaultGenerationSpecs.durationSeconds ?? 8)}
          >
            {durationOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={dict.aspectRatioLabel}>
          <Select name="aspectRatio" defaultValue={defaults?.defaultGenerationSpecs.aspectRatio ?? "9:16"}>
            {aspectRatioOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Button type="submit" variant="primary">
        {submitLabel}
      </Button>
    </form>
  );
}
