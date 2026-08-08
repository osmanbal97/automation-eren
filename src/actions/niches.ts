import { asc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { niches, platformConnections, videoProviders } from "@/db/schema";
import { ActionNotFoundError } from "./errors";

/** Niches aren't triggered from Telegram, so unlike ideas/videos/scheduling there's no channel to track here. */

export interface TargetPostsPerDay {
  tiktok: number;
  instagram: number;
  youtube: number;
}

export interface NicheGenerationSpecs {
  resolution: string;
  durationSeconds: number;
  aspectRatio: string;
}

export interface NicheInput {
  name: string;
  themeGuidance: string;
  targetPostsPerDay: TargetPostsPerDay;
  defaultProviderId: string | null;
  defaultGenerationSpecs: NicheGenerationSpecs;
}

async function getNicheOrThrow(db: Database, nicheId: string) {
  const [niche] = await db.select().from(niches).where(eq(niches.id, nicheId));
  if (!niche) {
    throw new ActionNotFoundError("Niche", nicheId);
  }
  return niche;
}

export async function getNiche(db: Database, nicheId: string) {
  return getNicheOrThrow(db, nicheId);
}

/** Niche list joined with its default provider's name and every platform_connections row it has (0-3). */
export async function listNichesWithConnections(db: Database) {
  const rows = await db
    .select({
      id: niches.id,
      name: niches.name,
      themeGuidance: niches.themeGuidance,
      targetPostsPerDay: niches.targetPostsPerDay,
      defaultProviderId: niches.defaultProviderId,
      defaultGenerationSpecs: niches.defaultGenerationSpecs,
      defaultProviderName: videoProviders.name,
    })
    .from(niches)
    .leftJoin(videoProviders, eq(niches.defaultProviderId, videoProviders.id))
    .orderBy(asc(niches.name));

  const allConnections = await db.select().from(platformConnections);
  const connectionsByNiche = new Map<string, (typeof allConnections)[number][]>();
  for (const connection of allConnections) {
    const existing = connectionsByNiche.get(connection.nicheId) ?? [];
    existing.push(connection);
    connectionsByNiche.set(connection.nicheId, existing);
  }

  return rows.map((niche) => ({
    ...niche,
    connections: connectionsByNiche.get(niche.id) ?? [],
  }));
}

export async function createNiche(db: Database, input: NicheInput) {
  const [niche] = await db
    .insert(niches)
    .values({
      name: input.name,
      themeGuidance: input.themeGuidance,
      targetPostsPerDay: input.targetPostsPerDay,
      defaultProviderId: input.defaultProviderId,
      defaultGenerationSpecs: input.defaultGenerationSpecs,
    })
    .returning();
  return niche;
}

export async function updateNiche(db: Database, nicheId: string, input: NicheInput) {
  await getNicheOrThrow(db, nicheId);
  const [updated] = await db
    .update(niches)
    .set({
      name: input.name,
      themeGuidance: input.themeGuidance,
      targetPostsPerDay: input.targetPostsPerDay,
      defaultProviderId: input.defaultProviderId,
      defaultGenerationSpecs: input.defaultGenerationSpecs,
      updatedAt: new Date(),
    })
    .where(eq(niches.id, nicheId))
    .returning();
  return updated;
}

export async function deleteNiche(db: Database, nicheId: string) {
  await getNicheOrThrow(db, nicheId);
  const [deleted] = await db.delete(niches).where(eq(niches.id, nicheId)).returning();
  return deleted;
}
