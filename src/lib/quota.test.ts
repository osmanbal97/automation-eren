import { describe, expect, it } from "vitest";
import { checkQuota, QuotaExceededError, recordUsage, type QuotaStore } from "./quota";

function createFakeQuotaStore(initial: Record<string, number> = {}): QuotaStore {
  const usage = new Map(Object.entries(initial));
  const key = (provider: string, date: string) => `${provider}::${date}`;
  return {
    async getUsage(provider, date) {
      return usage.get(key(provider, date)) ?? 0;
    },
    async incrementUsage(provider, date, units) {
      const current = usage.get(key(provider, date)) ?? 0;
      usage.set(key(provider, date), current + units);
    },
  };
}

describe("quota", () => {
  describe("checkQuota", () => {
    it("allows a call comfortably under the daily cap", async () => {
      const store = createFakeQuotaStore({ "higgsfield::2026-08-08": 10 });

      await expect(checkQuota(store, "higgsfield", 5, 100, "2026-08-08")).resolves.toBeUndefined();
    });

    it("allows a call that lands exactly on the daily cap", async () => {
      const store = createFakeQuotaStore({ "youtube::2026-08-08": 8400 });

      await expect(checkQuota(store, "youtube", 1600, 10000, "2026-08-08")).resolves.toBeUndefined();
    });

    it("blocks an over-cap call with a typed QuotaExceededError", async () => {
      const store = createFakeQuotaStore({ "youtube::2026-08-08": 8401 });

      await expect(checkQuota(store, "youtube", 1600, 10000, "2026-08-08")).rejects.toThrow(
        QuotaExceededError,
      );
    });

    it("carries provider/usage/needed/cap details on the thrown error", async () => {
      const store = createFakeQuotaStore({ "youtube::2026-08-08": 9500 });

      try {
        await checkQuota(store, "youtube", 1600, 10000, "2026-08-08");
        expect.fail("expected checkQuota to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(QuotaExceededError);
        const quotaError = error as QuotaExceededError;
        expect(quotaError.provider).toBe("youtube");
        expect(quotaError.unitsUsed).toBe(9500);
        expect(quotaError.unitsNeeded).toBe(1600);
        expect(quotaError.dailyCap).toBe(10000);
      }
    });

    it("treats a provider with no recorded usage yet as zero", async () => {
      const store = createFakeQuotaStore();

      await expect(checkQuota(store, "tiktok", 1, 25, "2026-08-08")).resolves.toBeUndefined();
    });
  });

  describe("recordUsage", () => {
    it("increments the store and is reflected by a subsequent checkQuota", async () => {
      const store = createFakeQuotaStore();

      await recordUsage(store, "tiktok", 20, "2026-08-08");
      await recordUsage(store, "tiktok", 5, "2026-08-08");

      await expect(checkQuota(store, "tiktok", 1, 25, "2026-08-08")).rejects.toThrow(QuotaExceededError);
      await expect(checkQuota(store, "tiktok", 0, 25, "2026-08-08")).resolves.toBeUndefined();
    });

    it("keeps separate counters per provider and per date", async () => {
      const store = createFakeQuotaStore();

      await recordUsage(store, "tiktok", 20, "2026-08-08");
      await recordUsage(store, "youtube", 20, "2026-08-08");
      await recordUsage(store, "tiktok", 20, "2026-08-09");

      await expect(checkQuota(store, "tiktok", 5, 25, "2026-08-08")).resolves.toBeUndefined();
      await expect(checkQuota(store, "tiktok", 6, 25, "2026-08-08")).rejects.toThrow(QuotaExceededError);
    });
  });
});
