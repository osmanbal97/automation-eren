import type { ErrorLogStore } from "@/lib/error-log";
import { HiggsfieldProvider } from "./higgsfield";
import type { VideoProvider } from "./types";

export class UnknownProviderError extends Error {
  constructor(public readonly adapterKey: string) {
    super(`No video provider adapter registered for "${adapterKey}"`);
    this.name = "UnknownProviderError";
  }
}

export class ProviderNotImplementedError extends Error {
  constructor(public readonly adapterKey: string) {
    super(`Video provider adapter "${adapterKey}" is not implemented yet`);
    this.name = "ProviderNotImplementedError";
  }
}

export interface AdapterRegistryOptions {
  errorLogStore?: ErrorLogStore;
}

/**
 * Maps video_providers.adapter_key (US-006 seed data) to a live adapter
 * instance. "nano_banana" and "omni" are seeded as disabled placeholders —
 * they resolve here to a typed not-implemented error rather than an unknown
 * key, so callers can distinguish "not built yet" from "typo in adapter_key".
 */
export function getVideoProvider(
  adapterKey: string,
  options: AdapterRegistryOptions = {},
): VideoProvider {
  switch (adapterKey) {
    case "higgsfield": {
      const apiKey = process.env.HIGGSFIELD_API_KEY;
      if (!apiKey) {
        throw new Error("HIGGSFIELD_API_KEY is not set");
      }
      return new HiggsfieldProvider({ apiKey, errorLogStore: options.errorLogStore });
    }
    case "nano_banana":
    case "omni":
      throw new ProviderNotImplementedError(adapterKey);
    default:
      throw new UnknownProviderError(adapterKey);
  }
}
