import { and, eq, sql } from "drizzle-orm";
import { type Database, getDb } from "@/db/client";
import { apiQuotaUsage } from "@/db/schema";

export class QuotaExceededError extends Error {
  constructor(
    public readonly provider: string,
    public readonly unitsUsed: number,
    public readonly unitsNeeded: number,
    public readonly dailyCap: number,
  ) {
    super(
      `Quota exceeded for "${provider}": ${unitsUsed} used + ${unitsNeeded} needed > daily cap of ${dailyCap}`,
    );
    this.name = "QuotaExceededError";
  }
}

/**
 * Storage abstraction for daily per-provider usage counters. Lets callers
 * (and tests) swap the real Postgres-backed implementation for an in-memory
 * fake without touching the quota-checking logic itself.
 */
export interface QuotaStore {
  getUsage(provider: string, date: string): Promise<number>;
  incrementUsage(provider: string, date: string, units: number): Promise<void>;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createDrizzleQuotaStore(db: Database = getDb()): QuotaStore {
  return {
    async getUsage(provider, date) {
      const rows = await db
        .select({ unitsUsed: apiQuotaUsage.unitsUsed })
        .from(apiQuotaUsage)
        .where(and(eq(apiQuotaUsage.provider, provider), eq(apiQuotaUsage.usageDate, date)));
      return rows[0]?.unitsUsed ?? 0;
    },
    async incrementUsage(provider, date, units) {
      await db
        .insert(apiQuotaUsage)
        .values({ provider, usageDate: date, unitsUsed: units })
        .onConflictDoUpdate({
          target: [apiQuotaUsage.provider, apiQuotaUsage.usageDate],
          set: {
            unitsUsed: sql`${apiQuotaUsage.unitsUsed} + ${units}`,
            updatedAt: new Date(),
          },
        });
    },
  };
}

/**
 * Pre-check to run before spending money/quota on an external API call.
 * Throws QuotaExceededError instead of letting the caller find out via a
 * failed (and possibly billed) request.
 */
export async function checkQuota(
  store: QuotaStore,
  provider: string,
  unitsNeeded: number,
  dailyCap: number,
  date: string = todayUtc(),
): Promise<void> {
  const unitsUsed = await store.getUsage(provider, date);
  if (unitsUsed + unitsNeeded > dailyCap) {
    throw new QuotaExceededError(provider, unitsUsed, unitsNeeded, dailyCap);
  }
}

/** Records units consumed against a provider's daily counter. */
export async function recordUsage(
  store: QuotaStore,
  provider: string,
  units: number,
  date: string = todayUtc(),
): Promise<void> {
  await store.incrementUsage(provider, date, units);
}
