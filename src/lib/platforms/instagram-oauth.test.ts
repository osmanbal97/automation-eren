import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildInstagramAuthorizeUrl, exchangeInstagramCode } from "./instagram-oauth";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const REDIRECT_URI = "https://app.example/api/auth/instagram/callback";

const exchangeOptions = {
  clientId: "app-id",
  clientSecret: "app-secret",
};

describe("buildInstagramAuthorizeUrl", () => {
  it("builds the Facebook Login dialog URL with the expected params", () => {
    const url = new URL(
      buildInstagramAuthorizeUrl("state-123", REDIRECT_URI, { clientId: "app-id" }),
    );

    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v21.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("app-id");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(
      "instagram_basic,instagram_content_publish,pages_show_list,business_management",
    );
  });

  it("falls back to META_APP_ID and honours an api version override", () => {
    vi.stubEnv("META_APP_ID", "env-app-id");

    const url = new URL(
      buildInstagramAuthorizeUrl("state-abc", REDIRECT_URI, { apiVersion: "v19.0" }),
    );

    expect(url.pathname).toBe("/v19.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("env-app-id");

    vi.unstubAllEnvs();
  });
});

describe("exchangeInstagramCode", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  function options() {
    return { ...exchangeOptions, fetchImpl: fetchImpl as unknown as typeof fetch };
  }

  /** Pass `null` to simulate Meta omitting `expires_in` on the long-lived token. */
  function mockHappyPath(longLivedExpiresIn: number | null = 5_183_944) {
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "short-lived-token",
          token_type: "bearer",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "long-lived-token",
          token_type: "bearer",
          ...(longLivedExpiresIn === null ? {} : { expires_in: longLivedExpiresIn }),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { data: [{ id: "page-1", name: "Cats Daily" }, { id: "page-2" }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { instagram_business_account: { id: "17841400000000000" } }),
      );
  }

  it("resolves through all four calls and maps the fields onto ConnectionTokens", async () => {
    mockHappyPath();
    const before = Date.now();

    const tokens = await exchangeInstagramCode("auth-code", REDIRECT_URI, options());

    expect(tokens.accessToken).toBe("long-lived-token");
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.externalAccountId).toBe("17841400000000000");
    expect(tokens.expiresAt).toBeInstanceOf(Date);
    expect(tokens.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 5_183_944 * 1000);

    expect(fetchImpl).toHaveBeenCalledTimes(4);

    const [codeUrl, codeInit] = fetchImpl.mock.calls[0];
    const code = new URL(codeUrl as string);
    expect(code.origin + code.pathname).toBe(
      "https://graph.facebook.com/v21.0/oauth/access_token",
    );
    expect(code.searchParams.get("client_id")).toBe("app-id");
    expect(code.searchParams.get("client_secret")).toBe("app-secret");
    expect(code.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(code.searchParams.get("code")).toBe("auth-code");
    expect((codeInit as RequestInit).method).toBe("GET");

    const longLived = new URL(fetchImpl.mock.calls[1][0] as string);
    expect(longLived.pathname).toBe("/v21.0/oauth/access_token");
    expect(longLived.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(longLived.searchParams.get("fb_exchange_token")).toBe("short-lived-token");

    const accounts = new URL(fetchImpl.mock.calls[2][0] as string);
    expect(accounts.pathname).toBe("/v21.0/me/accounts");
    expect(accounts.searchParams.get("access_token")).toBe("long-lived-token");

    const page = new URL(fetchImpl.mock.calls[3][0] as string);
    expect(page.pathname).toBe("/v21.0/page-1");
    expect(page.searchParams.get("fields")).toBe("instagram_business_account");
    expect(page.searchParams.get("access_token")).toBe("long-lived-token");
  });

  it("defaults the expiry to ~60 days when Meta omits expires_in", async () => {
    mockHappyPath(null);
    const before = Date.now();

    const tokens = await exchangeInstagramCode("auth-code", REDIRECT_URI, options());

    expect(tokens.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 5_184_000 * 1000);
    expect(tokens.expiresAt!.getTime()).toBeLessThan(before + 5_184_000 * 1000 + 60_000);
  });

  it("throws a clear error when no Facebook Page is connected", async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "short-lived-token" }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "long-lived-token" }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }));

    await expect(exchangeInstagramCode("auth-code", REDIRECT_URI, options())).rejects.toThrow(
      /No Facebook Page connected to this account/,
    );

    // It never reaches the /{page-id} lookup.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws a clear error when the Page has no linked Instagram Business Account", async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "short-lived-token" }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "long-lived-token" }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ id: "page-1" }] }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "page-1" }));

    await expect(exchangeInstagramCode("auth-code", REDIRECT_URI, options())).rejects.toThrow(
      /Connected Page has no linked Instagram Business Account/,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("throws with the Graph message when the code exchange fails", async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(400, {
        error: { message: "This authorization code has been used.", type: "OAuthException", code: 100 },
      }),
    );

    await expect(exchangeInstagramCode("auth-code", REDIRECT_URI, options())).rejects.toThrow(
      /authorization code exchange failed \(HTTP 400\): This authorization code has been used\./,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws with the Graph message when the long-lived exchange fails", async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "short-lived-token" }))
      .mockResolvedValueOnce(
        jsonResponse(400, { error: { message: "Invalid appsecret", code: 1 } }),
      );

    await expect(exchangeInstagramCode("auth-code", REDIRECT_URI, options())).rejects.toThrow(
      /long-lived token exchange failed \(HTTP 400\): Invalid appsecret/,
    );
  });

  it("throws with the Graph message when the page lookup fails", async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "short-lived-token" }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "long-lived-token" }))
      .mockResolvedValueOnce(
        jsonResponse(403, {
          error: { message: "(#200) Requires pages_show_list permission", code: 200 },
        }),
      );

    await expect(exchangeInstagramCode("auth-code", REDIRECT_URI, options())).rejects.toThrow(
      /page lookup failed \(HTTP 403\): \(#200\) Requires pages_show_list permission/,
    );
  });

  it("throws with the Graph message when the instagram account lookup fails", async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "short-lived-token" }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "long-lived-token" }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ id: "page-1" }] }))
      .mockResolvedValueOnce(
        jsonResponse(401, {
          error: { message: "Error validating access token: Session has expired", code: 190 },
        }),
      );

    await expect(exchangeInstagramCode("auth-code", REDIRECT_URI, options())).rejects.toThrow(
      /business account lookup failed \(HTTP 401\): Error validating access token: Session has expired/,
    );
  });

  it("surfaces a Graph error envelope returned with a 200 status", async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(200, { error: { message: "Something went wrong", code: 1 } }),
    );

    await expect(exchangeInstagramCode("auth-code", REDIRECT_URI, options())).rejects.toThrow(
      /Something went wrong/,
    );
  });

  it("throws when the code exchange returns no access token", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { token_type: "bearer" }));

    await expect(exchangeInstagramCode("auth-code", REDIRECT_URI, options())).rejects.toThrow(
      /authorization code exchange returned no access token/,
    );
  });
});
