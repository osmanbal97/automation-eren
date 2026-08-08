import type { NicheGenerationSpecs, TargetPostsPerDay } from "@/actions/niches";
import type { videoProviders } from "@/db/schema";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";

type Provider = typeof videoProviders.$inferSelect;

const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;

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
    <form action={action} className="space-y-5">
      <Field label="Name">
        <Input name="name" required defaultValue={defaults?.name} placeholder="Trippy POV" />
      </Field>

      <Field label="Theme guidance" hint="Fed to Claude verbatim when drafting ideas.">
        <Textarea
          name="themeGuidance"
          required
          rows={3}
          defaultValue={defaults?.themeGuidance}
          placeholder="Hyper-saturated first-person psychedelia, impossible architecture, slow dolly moves…"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        {PLATFORMS.map((platform) => (
          <Field key={platform} label={`${platform} / day`}>
            <Input
              type="number"
              min={0}
              name={`${platform}PerDay`}
              defaultValue={defaults?.targetPostsPerDay[platform] ?? 0}
            />
          </Field>
        ))}
      </div>

      <Field label="Default provider">
        <Select name="defaultProviderId" defaultValue={defaults?.defaultProviderId ?? ""}>
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
            defaultValue={defaults?.defaultGenerationSpecs.resolution ?? "1080x1920"}
          />
        </Field>
        <Field label="Duration (s)">
          <Input
            type="number"
            min={1}
            name="durationSeconds"
            required
            defaultValue={defaults?.defaultGenerationSpecs.durationSeconds ?? 8}
          />
        </Field>
        <Field label="Aspect ratio">
          <Input
            name="aspectRatio"
            required
            defaultValue={defaults?.defaultGenerationSpecs.aspectRatio ?? "9:16"}
          />
        </Field>
      </div>

      <Button type="submit" variant="primary">
        {submitLabel}
      </Button>
    </form>
  );
}
