import { getDb } from "./client";
import { videoProviders } from "./schema";

/**
 * Seed data for the video-provider registry (US-006). Higgsfield is the
 * only provider we can actually call today; Nano Banana and Omni are
 * disabled placeholders so the niche/idea provider-select UI has something
 * to show ahead of building their adapters.
 */
export const providerSeeds: (typeof videoProviders.$inferInsert)[] = [
  {
    name: "Higgsfield",
    adapterKey: "higgsfield",
    pricingModel: "per_second",
    unitPrice: "0.2000",
    defaultSpecs: { resolution: "1080x1920", durationSeconds: 8, fps: 24 },
    enabled: true,
  },
  {
    name: "Nano Banana",
    adapterKey: "nano_banana",
    pricingModel: "per_generation",
    unitPrice: "1.5000",
    defaultSpecs: { resolution: "1080x1920", durationSeconds: 6 },
    enabled: false,
  },
  {
    name: "Omni",
    adapterKey: "omni",
    pricingModel: "per_credit",
    unitPrice: "0.0500",
    defaultSpecs: { resolution: "1080x1920", durationSeconds: 10 },
    enabled: false,
  },
];

export async function seedProviders() {
  const db = getDb();
  for (const provider of providerSeeds) {
    await db
      .insert(videoProviders)
      .values(provider)
      .onConflictDoUpdate({
        target: videoProviders.adapterKey,
        set: {
          name: provider.name,
          pricingModel: provider.pricingModel,
          unitPrice: provider.unitPrice,
          defaultSpecs: provider.defaultSpecs,
          enabled: provider.enabled,
          updatedAt: new Date(),
        },
      });
  }
}

// Allow running directly: `npx tsx src/db/seed-providers.ts`
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  seedProviders()
    .then(() => {
      console.log(`Seeded ${providerSeeds.length} video providers.`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed to seed video providers:", error);
      process.exit(1);
    });
}
