import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { decryptToken } from "@/lib/crypto";
import { getConnectionsForNiche, saveConnectionTokens, setConnectionStatus } from "./platform-connections";
import { seedNiche } from "./test-helpers";

describe("platform connection actions", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
    // saveConnectionTokens encrypts via crypto.ts, which requires this to be set.
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
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

  describe("saveConnectionTokens", () => {
    it("creates an active connection with encrypted tokens", async () => {
      const niche = await seedNiche(db);
      const expiresAt = new Date(Date.now() + 3600_000);

      const connection = await saveConnectionTokens(db, niche.id, "tiktok", {
        accessToken: "raw-access-token",
        refreshToken: "raw-refresh-token",
        expiresAt,
        externalAccountId: "tiktok-user-1",
      });

      expect(connection.status).toBe("active");
      expect(connection.externalAccountId).toBe("tiktok-user-1");
      expect(connection.tokenExpiresAt).toEqual(expiresAt);
      expect(connection.accessTokenEncrypted).not.toBe("raw-access-token");
      expect(decryptToken(connection.accessTokenEncrypted!)).toBe("raw-access-token");
      expect(decryptToken(connection.refreshTokenEncrypted!)).toBe("raw-refresh-token");
    });

    it("stores a null refresh token when the platform didn't return one", async () => {
      const niche = await seedNiche(db);

      const connection = await saveConnectionTokens(db, niche.id, "youtube", { accessToken: "raw-access-token" });

      expect(connection.refreshTokenEncrypted).toBeNull();
    });

    it("re-running for the same niche+platform updates the existing row instead of duplicating", async () => {
      const niche = await seedNiche(db);
      const first = await saveConnectionTokens(db, niche.id, "instagram", { accessToken: "token-1" });

      const second = await saveConnectionTokens(db, niche.id, "instagram", { accessToken: "token-2" });

      expect(second.id).toBe(first.id);
      expect(decryptToken(second.accessTokenEncrypted!)).toBe("token-2");
      const all = await getConnectionsForNiche(db, niche.id);
      expect(all).toHaveLength(1);
    });

    it("re-activates a previously disconnected connection", async () => {
      const niche = await seedNiche(db);
      await setConnectionStatus(db, niche.id, "tiktok", "disconnected");

      const reconnected = await saveConnectionTokens(db, niche.id, "tiktok", { accessToken: "fresh-token" });

      expect(reconnected.status).toBe("active");
    });
  });
});
