import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptToken, decryptTokenOrNull, encryptToken, TokenEncryptionError } from "./crypto";

const KEY = randomBytes(32).toString("base64");

describe("token encryption", () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.TOKEN_ENCRYPTION_KEY = originalKey;
    }
  });

  it("round-trips a token", () => {
    const token = "ya29.a0AfB_by-some-oauth-access-token";
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it("produces a versioned four-part envelope", () => {
    const parts = encryptToken("hello").split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("produces different ciphertext each time (random IV) but decrypts to the same value", () => {
    const a = encryptToken("same-token");
    const b = encryptToken("same-token");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("same-token");
    expect(decryptToken(b)).toBe("same-token");
  });

  it("round-trips unicode and empty strings", () => {
    expect(decryptToken(encryptToken(""))).toBe("");
    expect(decryptToken(encryptToken("токен-✨-🎬"))).toBe("токен-✨-🎬");
  });

  it("accepts a hex-encoded key as well as base64", () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    expect(decryptToken(encryptToken("hex-keyed"))).toBe("hex-keyed");
  });

  it("throws when the key is missing", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(TokenEncryptionError);
  });

  it("throws when the key is the wrong length", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptToken("x")).toThrow(/32 bytes/);
  });

  it("rejects a tampered ciphertext rather than returning garbage", () => {
    const envelope = encryptToken("sensitive");
    const parts = envelope.split(":");
    // Flip the ciphertext to a different valid base64url value.
    parts[3] = Buffer.from("tampered-value").toString("base64url");
    expect(() => decryptToken(parts.join(":"))).toThrow(TokenEncryptionError);
  });

  it("rejects a token encrypted under a different key", () => {
    const envelope = encryptToken("sensitive");
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptToken(envelope)).toThrow(/wrong key or tampered/);
  });

  it("rejects a malformed envelope", () => {
    expect(() => decryptToken("not-an-envelope")).toThrow(/Malformed/);
    expect(() => decryptToken("v1:only:three")).toThrow(/Malformed/);
  });

  it("rejects an unknown envelope version", () => {
    const parts = encryptToken("x").split(":");
    parts[0] = "v2";
    expect(() => decryptToken(parts.join(":"))).toThrow(/Unsupported token envelope version/);
  });

  it("passes null and undefined straight through in the nullable helper", () => {
    expect(decryptTokenOrNull(null)).toBeNull();
    expect(decryptTokenOrNull(undefined)).toBeNull();
    expect(decryptTokenOrNull(encryptToken("v"))).toBe("v");
  });
});
