import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { getConnectionsForNiche, setConnectionStatus } from "./platform-connections";
import { seedNiche } from "./test-helpers";

describe("platform connection actions", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  describe("setConnectionStatus", () => {
    it("creates a connection row when none exists yet", async () => {
      const niche = await seedNiche(db);

      const connection = await setConnectionStatus(db, niche.id, "tiktok", "pending_review");

      expect(connection.nicheId).toBe(niche.id);
      expect(connection.platform).toBe("tiktok");
      expect(connection.status).toBe("pending_review");
    });

    it("updates the existing row (and bumps updatedAt) instead of creating a duplicate", async () => {
      const niche = await seedNiche(db);
      const created = await setConnectionStatus(db, niche.id, "instagram", "pending_review");

      const updated = await setConnectionStatus(db, niche.id, "instagram", "active");

      expect(updated.id).toBe(created.id);
      expect(updated.status).toBe("active");
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

      const all = await getConnectionsForNiche(db, niche.id);
      expect(all).toHaveLength(1);
    });

    it("can be reset back to disconnected", async () => {
      const niche = await seedNiche(db);
      await setConnectionStatus(db, niche.id, "youtube", "active");

      const reset = await setConnectionStatus(db, niche.id, "youtube", "disconnected");

      expect(reset.status).toBe("disconnected");
    });

    it("tracks each platform independently for the same niche", async () => {
      const niche = await seedNiche(db);
      await setConnectionStatus(db, niche.id, "tiktok", "active");
      await setConnectionStatus(db, niche.id, "instagram", "pending_review");

      const all = await getConnectionsForNiche(db, niche.id);

      expect(all).toHaveLength(2);
      expect(all.find((c) => c.platform === "tiktok")?.status).toBe("active");
      expect(all.find((c) => c.platform === "instagram")?.status).toBe("pending_review");
    });
  });

  describe("getConnectionsForNiche", () => {
    it("returns an empty array for a niche with no connections", async () => {
      const niche = await seedNiche(db);

      const all = await getConnectionsForNiche(db, niche.id);

      expect(all).toEqual([]);
    });
  });
});
