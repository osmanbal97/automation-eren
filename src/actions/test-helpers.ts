import type { Database } from "@/db/client";
import {
  generationJobs,
  ideas,
  niches,
  publishJobs,
  scheduledPosts,
  videoProviders,
  videos,
} from "@/db/schema";

export async function seedNiche(db: Database, overrides: Partial<typeof niches.$inferInsert> = {}) {
  const [niche] = await db
    .insert(niches)
    .values({ name: "Trippy POV", themeGuidance: "psychedelic first-person rides", ...overrides })
    .returning();
  return niche;
}

export async function seedProvider(
  db: Database,
  overrides: Partial<typeof videoProviders.$inferInsert> = {},
) {
  const [provider] = await db
    .insert(videoProviders)
    .values({
      name: "Higgsfield",
      adapterKey: "higgsfield",
      pricingModel: "per_second",
      unitPrice: "0.10",
      ...overrides,
    })
    .returning();
  return provider;
}

export async function seedIdea(
  db: Database,
  nicheId: string,
  overrides: Partial<typeof ideas.$inferInsert> = {},
) {
  const [idea] = await db
    .insert(ideas)
    .values({
      nicheId,
      title: "Infinite tunnel bike ride",
      concept: "POV riding a bike into an infinite colorful tunnel",
      prompt: "first-person pov, riding a bicycle into an infinite trippy tunnel, vibrant colors",
      caption: "into the void \u{1F308}",
      ...overrides,
    })
    .returning();
  return idea;
}

export async function seedGenerationJob(
  db: Database,
  ideaId: string,
  providerId: string,
  overrides: Partial<typeof generationJobs.$inferInsert> = {},
) {
  const [job] = await db
    .insert(generationJobs)
    .values({ ideaId, providerId, ...overrides })
    .returning();
  return job;
}

export async function seedVideo(
  db: Database,
  nicheId: string,
  ideaId: string,
  generationJobId: string,
  overrides: Partial<typeof videos.$inferInsert> = {},
) {
  const [video] = await db
    .insert(videos)
    .values({
      nicheId,
      ideaId,
      generationJobId,
      blobUrl: "https://blob.example.com/videos/clip.mp4",
      caption: "into the void \u{1F308}",
      ...overrides,
    })
    .returning();
  return video;
}

export async function seedScheduledPost(
  db: Database,
  videoId: string,
  nicheId: string,
  overrides: Partial<typeof scheduledPosts.$inferInsert> = {},
) {
  const [post] = await db
    .insert(scheduledPosts)
    .values({ videoId, nicheId, platform: "tiktok", scheduledAt: new Date(), ...overrides })
    .returning();
  return post;
}

export async function seedPublishJob(
  db: Database,
  scheduledPostId: string,
  overrides: Partial<typeof publishJobs.$inferInsert> = {},
) {
  const [job] = await db
    .insert(publishJobs)
    .values({ scheduledPostId, ...overrides })
    .returning();
  return job;
}
