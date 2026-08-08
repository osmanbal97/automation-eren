import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { platformConnections } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { ActionNotFoundError } from "./errors";
import { createNiche, deleteNiche, getNiche, listNichesWithConnections, updateNiche } from "./niches";
import { seedNiche, seedProvider } from "./test-helpers";

const specs = { resolution: "1080x1920", durationSeconds: 8, aspectRatio: "9:16" };
const targetPostsPerDay = { tiktok: 2, instagram: 1, youtube: 1 };

describe("niche actions", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  describe("createNiche", () => {
    it("creates a niche with the given fields", async () => {
      const provider = await seedProvider(db);

      const niche = await createNiche(db, {
        name: "Wholesome Rescue",
        themeGuidance: "a cat helping a human in small everyday ways",
        targetPostsPerDay,
        defaultProviderId: provider.id,
        defaultGenerationSpecs: specs,
      });

      expect(niche.name).toBe("Wholesome Rescue");
      expect(niche.defaultProviderId).toBe(provider.id);
      expect(niche.targetPostsPerDay).toEqual(targetPostsPerDay);
      expect(niche.defaultGenerationSpecs).toEqual(specs);
    });
  });

  describe("getNiche", () => {
    it("throws ActionNotFoundError for an unknown id", async () => {
      await expect(getNiche(db, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
        ActionNotFoundError,
      );
    });
  });

  describe("updateNiche", () => {
    it("updates the fields and bumps updatedAt", async () => {
      const niche = await seedNiche(db);

      const updated = await updateNiche(db, niche.id, {
        name: "Trippy POV v2",
        themeGuidance: "even more psychedelic",
        targetPostsPerDay,
        defaultProviderId: null,
        defaultGenerationSpecs: specs,
      });

      expect(updated.name).toBe("Trippy POV v2");
      expect(updated.defaultProviderId).toBeNull();
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(niche.updatedAt.getTime());
    });

    it("throws ActionNotFoundError for an unknown id", async () => {
      await expect(
        updateNiche(db, "00000000-0000-0000-0000-000000000000", {
          name: "x",
          themeGuidance: "x",
          targetPostsPerDay,
          defaultProviderId: null,
          defaultGenerationSpecs: specs,
        }),
      ).rejects.toThrow(ActionNotFoundError);
    });
  });

  describe("deleteNiche", () => {
    it("deletes the niche", async () => {
      const niche = await seedNiche(db);

      await deleteNiche(db, niche.id);

      await expect(getNiche(db, niche.id)).rejects.toThrow(ActionNotFoundError);
    });

    it("throws ActionNotFoundError for an unknown id", async () => {
      await expect(deleteNiche(db, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
        ActionNotFoundError,
      );
    });
  });

  describe("listNichesWithConnections", () => {
    it("returns each niche's default provider name and its platform connections", async () => {
      const provider = await seedProvider(db);
      const niche = await seedNiche(db, { defaultProviderId: provider.id });
      await db.insert(platformConnections).values({
        nicheId: niche.id,
        platform: "tiktok",
        status: "active",
      });

      const list = await listNichesWithConnections(db);

      expect(list).toHaveLength(1);
      expect(list[0].defaultProviderName).toBe(provider.name);
      expect(list[0].connections).toHaveLength(1);
      expect(list[0].connections[0]).toMatchObject({ platform: "tiktok", status: "active" });
    });

    it("returns an empty connections array for a niche with none", async () => {
      await seedNiche(db);

      const list = await listNichesWithConnections(db);

      expect(list[0].connections).toEqual([]);
    });
  });
});
