import { beforeEach, describe, expect, it, vi } from "vitest";
import { HiggsfieldProvider } from "./higgsfield";
import { ProviderApiError } from "./types";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("HiggsfieldProvider", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let provider: HiggsfieldProvider;

  beforeEach(() => {
    fetchImpl = vi.fn();
    provider = new HiggsfieldProvider({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
  });

  it("submits a generation and returns the external job id", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { id: "job-123" }));

    const jobId = await provider.submit("a cat helping a human stand up", {
      resolution: "1080x1920",
      durationSeconds: 8,
      fps: 24,
    });

    expect(jobId).toBe("job-123");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.higgsfield.ai/v1/generations");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body)).toMatchObject({
      prompt: "a cat helping a human stand up",
      resolution: "1080x1920",
      duration_seconds: 8,
      fps: 24,
    });
  });

  it.each([
    ["queued", "queued"],
    ["processing", "processing"],
    ["completed", "complete"],
    ["failed", "failed"],
  ] as const)("maps raw status %s to %s", async (raw, expected) => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { status: raw }));

    const status = await provider.getStatus("job-123");

    expect(status).toBe(expected);
  });

  it("returns the video URL and cost once a job is complete", async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(200, { status: "completed", video_url: "https://blob.example/v.mp4", cost: 1.6 }),
    );

    const result = await provider.getResult("job-123");

    expect(result).toEqual({ videoUrl: "https://blob.example/v.mp4", actualCost: 1.6 });
  });

  it("throws if getResult is called before a video_url is available", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { status: "processing" }));

    await expect(provider.getResult("job-123")).rejects.toThrow(/no video_url yet/);
  });

  it("retries transient 5xx failures and eventually throws once retries are exhausted", async () => {
    const fastProvider = new HiggsfieldProvider({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    fetchImpl.mockResolvedValue(jsonResponse(503, {}));

    await expect(
      fastProvider.submit("prompt", { resolution: "1080x1920", durationSeconds: 8 }),
    ).rejects.toThrow(/failed after 4 attempt\(s\)/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not retry a non-retryable 4xx and throws a typed ProviderApiError", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(404, {}));

    await expect(provider.getStatus("missing-job")).rejects.toThrow(ProviderApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws on an unrecognized status value from the provider", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { status: "somethingweird" }));

    await expect(provider.getStatus("job-123")).rejects.toThrow(/unrecognized job status/);
  });
});
