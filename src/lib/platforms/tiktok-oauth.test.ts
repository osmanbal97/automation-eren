import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTikTokAuthorizeUrl, exchangeTikTokCode } from "./tiktok-oauth";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const REDIRECT_URI = "https://app.example/api/auth/tiktok/callback";

describe("buildTikTokAuthorizeUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds the v2 authorize URL with the expected params", () => {
    const url = new URL(buildTikTokAuthorizeUrl("state-123", REDIRECT_URI, { clientKey: "test-client-key" }));

    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("test-client-key");
    expect(url.searchParams.get("scope")).toBe("user.info.basic,video.publish");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  it("falls back to TIKTOK_CLIENT_KEY from the environment", () => {
    vi.stubEnv("TIKTOK_CLIENT_KEY", "env-client-key");

    const url = new URL(buildTikTokAuthorizeUrl("state-123", REDIRECT_URI));

    expect(url.searchParams.get("client_key")).toBe("env-client-key");
  });

  it("throws when no client key is configured", () => {
    vi.stubEnv("TIKTOK_CLIENT_KEY", "");

    expect(() => buildTikTokAuthorizeUrl("state-123", REDIRECT_URI)).toThrow(/TIKTOK_CLIENT_KEY/);
  });
});

describe("exchangeTikTokCode", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  function exchange(code = "auth-code-1") {
    return exchangeTikTokCode(code, REDIRECT_URI, {
      clientKey: "test-client-key",
      clientSecret: "test-client-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
  }

  it("maps a successful exchange onto ConnectionTokens", async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: "act.new-access",
        refresh_token: "rft.new-refresh",
        expires_in: 86400,
        open_id: "open-id-1",
        scope: "user.info.basic,video.publish",
        token_type: "Bearer",
      }),
    );

    const tokens = await exchange();

    expect(tokens).toEqual({
      accessToken: "act.new-access",
      refreshToken: "rft.new-refresh",
      expiresAt: new Date("2026-08-09T12:00:00Z"),
      externalAccountId: "open-id-1",
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const form = new URLSearchParams(init.body as string);
    expect(form.get("client_key")).toBe("test-client-key");
    expect(form.get("client_secret")).toBe("test-client-secret");
    expect(form.get("code")).toBe("auth-code-1");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("redirect_uri")).toBe(REDIRECT_URI);
  });

  it("nulls out the optional fields TikTok omitted", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { access_token: "act.new-access" }));

    const tokens = await exchange();

    expect(tokens.refreshToken).toBeNull();
    expect(tokens.externalAccountId).toBeNull();
    // No expires_in means we cannot claim any lifetime -- treat it as already expired.
    expect(tokens.expiresAt).toEqual(new Date("2026-08-08T12:00:00Z"));
  });

  it("throws with the error code and description from an error envelope", async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(400, { error: "invalid_grant", error_description: "authorization code expired" }),
    );

    await expect(exchange()).rejects.toThrow(/invalid_grant: authorization code expired/);
  });

  it("throws on an error envelope returned with an HTTP 200", async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(200, { error: "invalid_client", error_description: "bad client_secret" }),
    );

    await expect(exchange()).rejects.toThrow(/invalid_client: bad client_secret/);
  });

  it("throws when the HTTP response is not ok and carries no error envelope", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(503, {}));

    await expect(exchange()).rejects.toThrow(/HTTP 503/);
  });

  it("throws when TikTok answers ok but omits the access token", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { open_id: "open-id-1" }));

    await expect(exchange()).rejects.toThrow(/no access_token/);
  });

  it("throws before calling fetch when the app credentials are not configured", async () => {
    vi.stubEnv("TIKTOK_CLIENT_KEY", "");
    vi.stubEnv("TIKTOK_CLIENT_SECRET", "");

    await expect(
      exchangeTikTokCode("auth-code-1", REDIRECT_URI, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/TIKTOK_CLIENT_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
