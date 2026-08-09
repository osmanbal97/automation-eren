import { describe, expect, it } from "vitest";
import { createOAuthState, OAuthStateError, verifyOAuthState } from "./oauth-state";

describe("createOAuthState / verifyOAuthState", () => {
  it("round-trips the nicheId when the cookie nonce matches", () => {
    const { state, nonce } = createOAuthState("niche-123");

    const result = verifyOAuthState(state, nonce);

    expect(result).toEqual({ nicheId: "niche-123" });
  });

  it("throws when the cookie nonce is missing", () => {
    const { state } = createOAuthState("niche-123");

    expect(() => verifyOAuthState(state, undefined)).toThrow(OAuthStateError);
  });

  it("throws when the state is missing", () => {
    const { nonce } = createOAuthState("niche-123");

    expect(() => verifyOAuthState(null, nonce)).toThrow(OAuthStateError);
  });

  it("throws when the nonce doesn't match (CSRF/replay protection)", () => {
    const { state } = createOAuthState("niche-123");

    expect(() => verifyOAuthState(state, "some-other-nonce")).toThrow(OAuthStateError);
  });

  it("throws on a malformed state string", () => {
    expect(() => verifyOAuthState("not-valid-base64json", "some-nonce")).toThrow(OAuthStateError);
  });
});
