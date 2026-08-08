import { describe, expect, it, beforeEach } from "vitest";
import { createSessionCookieValue, verifyPassword, verifySessionCookieValue } from "./auth";

describe("auth", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-value";
    process.env.APP_PASSWORD = "correct-horse";
  });

  describe("verifyPassword", () => {
    it("accepts the configured password", () => {
      expect(verifyPassword("correct-horse")).toBe(true);
    });

    it("rejects a wrong password", () => {
      expect(verifyPassword("wrong")).toBe(false);
    });

    it("rejects a same-length wrong password", () => {
      expect(verifyPassword("correct-horst")).toBe(false);
    });
  });

  describe("session cookie", () => {
    it("round-trips a freshly created cookie as valid", async () => {
      const cookie = await createSessionCookieValue();
      await expect(verifySessionCookieValue(cookie)).resolves.toBe(true);
    });

    it("rejects a tampered cookie", async () => {
      const cookie = await createSessionCookieValue();
      const [expiresAt] = cookie.split(".");
      const tampered = `${expiresAt}.deadbeef`;
      await expect(verifySessionCookieValue(tampered)).resolves.toBe(false);
    });

    it("rejects an expired cookie", async () => {
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 10;
      const tampered = `${expiredTimestamp}.deadbeef`;
      await expect(verifySessionCookieValue(tampered)).resolves.toBe(false);
    });

    it("rejects an empty/undefined cookie", async () => {
      await expect(verifySessionCookieValue(undefined)).resolves.toBe(false);
    });

    it("rejects a cookie signed with a different secret", async () => {
      const cookie = await createSessionCookieValue();
      process.env.AUTH_SECRET = "a-different-secret";
      await expect(verifySessionCookieValue(cookie)).resolves.toBe(false);
    });
  });
});
