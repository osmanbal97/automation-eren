import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HiggsfieldProvider } from "./higgsfield";
import { getVideoProvider, ProviderNotImplementedError, UnknownProviderError } from "./registry";

describe("getVideoProvider", () => {
  const originalKey = process.env.HIGGSFIELD_API_KEY;

  beforeEach(() => {
    process.env.HIGGSFIELD_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.HIGGSFIELD_API_KEY = originalKey;
  });

  it("resolves 'higgsfield' to a HiggsfieldProvider instance", () => {
    const provider = getVideoProvider("higgsfield");
    expect(provider).toBeInstanceOf(HiggsfieldProvider);
  });

  it("throws a clear error if HIGGSFIELD_API_KEY is missing", () => {
    delete process.env.HIGGSFIELD_API_KEY;
    expect(() => getVideoProvider("higgsfield")).toThrow(/HIGGSFIELD_API_KEY/);
  });

  it.each(["nano_banana", "omni"])("throws ProviderNotImplementedError for the %s placeholder", (key) => {
    expect(() => getVideoProvider(key)).toThrow(ProviderNotImplementedError);
  });

  it("throws UnknownProviderError for an unregistered adapter key", () => {
    expect(() => getVideoProvider("totally_made_up")).toThrow(UnknownProviderError);
  });
});
