import type { ErrorLogStore } from "./error-log";

export class RetryExhaustedError extends Error {
  constructor(
    public readonly provider: string,
    public readonly operation: string,
    public readonly attempts: number,
    public readonly cause?: unknown,
  ) {
    super(`"${operation}" against "${provider}" failed after ${attempts} attempt(s)`);
    this.name = "RetryExhaustedError";
  }
}

/** Anything with an HTTP-style status code — a fetch Response, or a provider SDK result. */
export interface RetryableResult {
  status: number;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

export interface CallWithRetryOptions<T extends RetryableResult> {
  /** External service name, e.g. "higgsfield", "tiktok", "youtube". Used for quota + error log rows. */
  provider: string;
  /** Short operation name, e.g. "generateVideo", "publishPost". */
  operation: string;
  /** Performs one attempt. Receives the 1-indexed attempt number. */
  execute: (attempt: number) => Promise<T>;
  /** When provided, an error_logs row is written once all attempts are exhausted. */
  errorLogStore?: ErrorLogStore;
  /** Short description of the request payload, stored on the error_logs row for debugging. */
  payloadSummary?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Injectable for tests; defaults to a real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; defaults to Math.random. */
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Calls `execute` with exponential backoff + jitter whenever it throws or
 * returns a 429/5xx result, up to `maxAttempts` tries. On the final failure,
 * logs to `errorLogStore` (if given) and throws a typed RetryExhaustedError.
 */
export async function callWithRetry<T extends RetryableResult>(
  options: CallWithRetryOptions<T>,
): Promise<T> {
  const {
    provider,
    operation,
    execute,
    errorLogStore,
    payloadSummary,
    maxAttempts = 4,
    baseDelayMs = 250,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  let lastResult: T | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = undefined;
    lastError = undefined;

    try {
      const result = await execute(attempt);
      if (!isRetryableStatus(result.status)) {
        return result;
      }
      lastResult = result;
    } catch (error) {
      lastError = error;
    }

    const isLastAttempt = attempt === maxAttempts;
    if (!isLastAttempt) {
      const backoffMs = baseDelayMs * 2 ** (attempt - 1);
      const jitterMs = backoffMs * 0.25 * random();
      await sleep(backoffMs + jitterMs);
    }
  }

  const errorMessage =
    lastError instanceof Error
      ? lastError.message
      : lastResult
        ? `HTTP ${lastResult.status}`
        : "Unknown error";

  if (errorLogStore) {
    await errorLogStore.log({
      provider,
      operation,
      payloadSummary,
      errorMessage,
      attemptCount: maxAttempts,
    });
  }

  throw new RetryExhaustedError(provider, operation, maxAttempts, lastError ?? lastResult);
}
