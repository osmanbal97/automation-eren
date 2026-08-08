import { describe, expect, it, vi } from "vitest";
import type { ErrorLogEntry, ErrorLogStore } from "./error-log";
import { callWithRetry, RetryExhaustedError } from "./resilient-client";

function createFakeErrorLogStore() {
  const entries: ErrorLogEntry[] = [];
  const store: ErrorLogStore = {
    async log(entry) {
      entries.push(entry);
    },
  };
  return { store, entries };
}

describe("callWithRetry", () => {
  it("returns the result on the first successful attempt without sleeping", async () => {
    const execute = vi.fn().mockResolvedValue({ status: 200, body: "ok" });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await callWithRetry({
      provider: "higgsfield",
      operation: "generateVideo",
      execute,
      sleep,
    });

    expect(result).toEqual({ status: 200, body: "ok" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries with exponential backoff + jitter on a 429, then succeeds", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ status: 200, body: "ok" });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await callWithRetry({
      provider: "tiktok",
      operation: "publishPost",
      execute,
      sleep,
      baseDelayMs: 250,
      random: () => 0.5, // deterministic jitter
    });

    expect(result).toEqual({ status: 200, body: "ok" });
    expect(execute).toHaveBeenCalledTimes(2);
    // attempt 1 backoff = 250 * 2^0 = 250, jitter = 250 * 0.25 * 0.5 = 31.25
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(281.25);
  });

  it("retries on 5xx responses the same as 429", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 200 });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await callWithRetry({ provider: "youtube", operation: "upload", execute, sleep });

    expect(result).toEqual({ status: 200 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-retryable 4xx statuses", async () => {
    const execute = vi.fn().mockResolvedValue({ status: 400, body: "bad request" });
    const sleep = vi.fn();

    const result = await callWithRetry({ provider: "youtube", operation: "upload", execute, sleep });

    expect(result).toEqual({ status: 400, body: "bad request" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws RetryExhaustedError and logs to error_logs once attempts are exhausted", async () => {
    const execute = vi.fn().mockResolvedValue({ status: 429 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { store, entries } = createFakeErrorLogStore();

    await expect(
      callWithRetry({
        provider: "higgsfield",
        operation: "generateVideo",
        execute,
        sleep,
        maxAttempts: 3,
        errorLogStore: store,
        payloadSummary: "prompt: trippy bike tunnel",
      }),
    ).rejects.toThrow(RetryExhaustedError);

    expect(execute).toHaveBeenCalledTimes(3);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      provider: "higgsfield",
      operation: "generateVideo",
      payloadSummary: "prompt: trippy bike tunnel",
      errorMessage: "HTTP 429",
      attemptCount: 3,
    });
  });

  it("retries on thrown errors (e.g. network failures) and reports them in the final error log", async () => {
    const networkError = new Error("fetch failed: ECONNRESET");
    const execute = vi.fn().mockRejectedValue(networkError);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { store, entries } = createFakeErrorLogStore();

    await expect(
      callWithRetry({
        provider: "meta",
        operation: "publishReel",
        execute,
        sleep,
        maxAttempts: 2,
        errorLogStore: store,
      }),
    ).rejects.toThrow(RetryExhaustedError);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(entries[0]?.errorMessage).toBe("fetch failed: ECONNRESET");
  });

  it("carries the provider/operation/attempts onto the thrown error", async () => {
    const execute = vi.fn().mockResolvedValue({ status: 500 });
    const sleep = vi.fn().mockResolvedValue(undefined);

    try {
      await callWithRetry({ provider: "tiktok", operation: "publishPost", execute, sleep, maxAttempts: 2 });
      expect.fail("expected callWithRetry to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RetryExhaustedError);
      const retryError = error as RetryExhaustedError;
      expect(retryError.provider).toBe("tiktok");
      expect(retryError.operation).toBe("publishPost");
      expect(retryError.attempts).toBe(2);
    }
  });
});
