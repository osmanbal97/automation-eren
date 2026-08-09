import Anthropic from "@anthropic-ai/sdk";

/** HTTP-style shape so this composes with callWithRetry (src/lib/resilient-client.ts)
 * the same way the fetch-based video provider adapters do. */
export interface ClaudeCompletionResult {
  status: number;
  text: string;
}

export interface ClaudeCompletionParams {
  system: string;
  prompt: string;
  maxTokens: number;
}

export interface ClaudeClient {
  complete(params: ClaudeCompletionParams): Promise<ClaudeCompletionResult>;
}

export interface AnthropicClaudeClientOptions {
  apiKey: string;
  model?: string;
}

const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Thin wrapper around the Anthropic SDK returning {status, text} instead of
 * throwing on API errors, so callWithRetry is the single source of retry/
 * backoff/quota/error-log behavior (the SDK's own retries are disabled via
 * maxRetries: 0 to avoid double-retrying on top of that).
 */
export function createAnthropicClaudeClient(options: AnthropicClaudeClientOptions): ClaudeClient {
  const client = new Anthropic({ apiKey: options.apiKey, maxRetries: 0 });
  const model = options.model ?? DEFAULT_MODEL;

  return {
    async complete({ system, prompt, maxTokens }) {
      try {
        const message = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: prompt }],
        });
        const textBlock = message.content.find((block) => block.type === "text");
        return { status: 200, text: textBlock?.text ?? "" };
      } catch (error) {
        if (error instanceof Anthropic.APIError && typeof error.status === "number") {
          return { status: error.status, text: "" };
        }
        throw error;
      }
    },
  };
}
