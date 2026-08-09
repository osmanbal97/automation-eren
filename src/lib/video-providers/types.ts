/**
 * Generation specs shape stored as JSON on video_providers.default_specs and
 * ideas.specs (per-idea override). Deliberately loose (no min/max validation
 * here) since different providers may support different resolutions/fps.
 */
export interface GenerationSpecs {
  resolution: string;
  durationSeconds: number;
  aspectRatio?: string;
  fps?: number;
  /** Only relevant for per_credit pricing providers; defaults to 1 credit per generation if omitted. */
  credits?: number;
}

/** Mirrors the generation_job_status pgEnum (US-002). */
export type VideoJobStatus = "queued" | "processing" | "complete" | "failed";

export interface VideoResult {
  videoUrl: string;
  /** Actual cost reported by the provider, if it exposes one; falls back to our estimate otherwise. */
  actualCost?: number;
  /** Provider-hosted thumbnail, when it generates one. Not every provider does -- US-017
   * only stores a thumbnail alongside the video when this is present. */
  thumbnailUrl?: string;
}

/**
 * Common interface every video-generation provider adapter implements, so
 * the rest of the system (generation queue, poller) never needs to know
 * which vendor is behind a given video_providers.adapter_key.
 */
export interface VideoProvider {
  /** Kicks off a generation job, returning the provider's external job id. */
  submit(prompt: string, specs: GenerationSpecs): Promise<string>;
  getStatus(jobId: string): Promise<VideoJobStatus>;
  /** Only meaningful once getStatus(jobId) === "complete". */
  getResult(jobId: string): Promise<VideoResult>;
}

export class ProviderApiError extends Error {
  constructor(
    public readonly provider: string,
    public readonly operation: string,
    public readonly status: number,
  ) {
    super(`${provider} ${operation} failed with HTTP ${status}`);
    this.name = "ProviderApiError";
  }
}
