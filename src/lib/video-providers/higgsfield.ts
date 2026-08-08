import type { ErrorLogStore } from "@/lib/error-log";
import { callWithRetry } from "@/lib/resilient-client";
import { ProviderApiError, type GenerationSpecs, type VideoJobStatus, type VideoProvider, type VideoResult } from "./types";

/**
 * Higgsfield's own status vocabulary isn't nailed down yet (no live account/API
 * docs at implementation time) — this maps the values we expect to see onto
 * our four-value generation_job_status enum. Adjust once we're calling the
 * real API and can see actual responses.
 */
const STATUS_MAP: Record<string, VideoJobStatus> = {
  queued: "queued",
  pending: "queued",
  processing: "processing",
  running: "processing",
  completed: "complete",
  succeeded: "complete",
  complete: "complete",
  failed: "failed",
  errored: "failed",
  error: "failed",
};

function normalizeStatus(raw: string): VideoJobStatus {
  const mapped = STATUS_MAP[raw.toLowerCase()];
  if (!mapped) {
    throw new Error(`Higgsfield returned an unrecognized job status: "${raw}"`);
  }
  return mapped;
}

interface HiggsfieldSubmitResponse {
  id: string;
}

interface HiggsfieldStatusResponse {
  status: string;
  video_url?: string;
  cost?: number;
}

export interface HiggsfieldProviderOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  errorLogStore?: ErrorLogStore;
  /** Retry tuning, passed straight through to callWithRetry — mainly for fast, deterministic tests. */
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class HiggsfieldProvider implements VideoProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly errorLogStore?: ErrorLogStore;
  private readonly maxAttempts?: number;
  private readonly baseDelayMs?: number;
  private readonly sleep?: (ms: number) => Promise<void>;
  private readonly random?: () => number;

  constructor(options: HiggsfieldProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.higgsfield.ai";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.errorLogStore = options.errorLogStore;
    this.maxAttempts = options.maxAttempts;
    this.baseDelayMs = options.baseDelayMs;
    this.sleep = options.sleep;
    this.random = options.random;
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    operation: string,
  ): Promise<T> {
    const response = await callWithRetry({
      provider: "higgsfield",
      operation,
      execute: () =>
        this.fetchImpl(`${this.baseUrl}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...init.headers,
          },
        }),
      errorLogStore: this.errorLogStore,
      payloadSummary: `${init.method ?? "GET"} ${path}`,
      maxAttempts: this.maxAttempts,
      baseDelayMs: this.baseDelayMs,
      sleep: this.sleep,
      random: this.random,
    });

    if (!response.ok) {
      throw new ProviderApiError("higgsfield", operation, response.status);
    }

    return (await response.json()) as T;
  }

  async submit(prompt: string, specs: GenerationSpecs): Promise<string> {
    const body = await this.requestJson<HiggsfieldSubmitResponse>(
      "/v1/generations",
      {
        method: "POST",
        body: JSON.stringify({
          prompt,
          resolution: specs.resolution,
          duration_seconds: specs.durationSeconds,
          fps: specs.fps,
        }),
      },
      "submit",
    );
    return body.id;
  }

  async getStatus(jobId: string): Promise<VideoJobStatus> {
    const body = await this.requestJson<HiggsfieldStatusResponse>(
      `/v1/generations/${jobId}`,
      { method: "GET" },
      "getStatus",
    );
    return normalizeStatus(body.status);
  }

  async getResult(jobId: string): Promise<VideoResult> {
    const body = await this.requestJson<HiggsfieldStatusResponse>(
      `/v1/generations/${jobId}`,
      { method: "GET" },
      "getResult",
    );
    if (!body.video_url) {
      throw new Error(`Higgsfield job ${jobId} has no video_url yet (status: ${body.status})`);
    }
    return { videoUrl: body.video_url, actualCost: body.cost };
  }
}
