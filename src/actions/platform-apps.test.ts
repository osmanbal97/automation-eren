import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { getPlatformAppCredentials, listPlatformAppStatuses, savePlatformAppCredentials } from "./platform-apps";

const ENV_VARS = [
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "META_APP_ID",
  "META_APP_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

describe("platform app credential actions", () => {
  let db: Database;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    for (const key of ENV_VARS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_VARS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  describe("savePlatformAppCredentials / getPlatformAppCredentials", () => {
    it("round-trips a platform's client id/secret encrypted at rest", async () => {
      await savePlatformAppCredentials(db, "tiktok", "client-key-1", "client-secret-1");

      const credentials = await getPlatformAppCredentials(db, "tiktok");

      expect(credentials).toEqual({ clientId: "client-key-1", clientSecret: "client-secret-1" });
    });

    it("re-saving the same platform updates the row instead of duplicating", async () => {
      await savePlatformAppCredentials(db, "instagram", "id-1", "secret-1");
      await savePlatformAppCredentials(db, "instagram", "id-2", "secret-2");

      const credentials = await getPlatformAppCredentials(db, "instagram");

      expect(credentials).toEqual({ clientId: "id-2", clientSecret: "secret-2" });
    });

    it("falls back to the platform's env vars when no row exists in the database", async () => {
      process.env.GOOGLE_CLIENT_ID = "env-google-id";
      process.env.GOOGLE_CLIENT_SECRET = "env-google-secret";

      const credentials = await getPlatformAppCredentials(db, "youtube");

      expect(credentials).toEqual({ clientId: "env-google-id", clientSecret: "env-google-secret" });
    });

    it("prefers the database row over env vars once one is configured", async () => {
      process.env.TIKTOK_CLIENT_KEY = "env-key";
      process.env.TIKTOK_CLIENT_SECRET = "env-secret";
      await savePlatformAppCredentials(db, "tiktok", "db-key", "db-secret");

      const credentials = await getPlatformAppCredentials(db, "tiktok");

      expect(credentials).toEqual({ clientId: "db-key", clientSecret: "db-secret" });
    });

    it("returns null when neither the database nor env has credentials", async () => {
      const credentials = await getPlatformAppCredentials(db, "instagram");

      expect(credentials).toBeNull();
    });
  });

  describe("listPlatformAppStatuses", () => {
    it("reports every platform, unconfigured by default", async () => {
      const statuses = await listPlatformAppStatuses(db);

      expect(statuses).toEqual([
        { platform: "tiktok", configured: false, clientIdPreview: null, source: "none" },
        { platform: "instagram", configured: false, clientIdPreview: null, source: "none" },
        { platform: "youtube", configured: false, clientIdPreview: null, source: "none" },
      ]);
    });

    it("marks a platform configured from the database and previews a masked client id", async () => {
      await savePlatformAppCredentials(db, "tiktok", "abcd1234", "shh");

      const statuses = await listPlatformAppStatuses(db);

      const tiktok = statuses.find((s) => s.platform === "tiktok");
      expect(tiktok).toEqual({ platform: "tiktok", configured: true, clientIdPreview: "1234", source: "database" });
    });

    it("marks a platform configured from env when no database row exists", async () => {
      process.env.META_APP_ID = "env-meta-id-9999";
      process.env.META_APP_SECRET = "env-meta-secret";

      const statuses = await listPlatformAppStatuses(db);

      const instagram = statuses.find((s) => s.platform === "instagram");
      expect(instagram).toEqual({
        platform: "instagram",
        configured: true,
        clientIdPreview: "9999",
        source: "env",
      });
    });

    it("never returns the client secret", async () => {
      await savePlatformAppCredentials(db, "youtube", "client-id", "top-secret-value");

      const statuses = await listPlatformAppStatuses(db);

      expect(JSON.stringify(statuses)).not.toContain("top-secret-value");
    });
  });
});
