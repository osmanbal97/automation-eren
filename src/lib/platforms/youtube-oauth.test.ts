import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildYouTubeAuthorizeUrl, exchangeYouTubeCode } from "./youtube-oauth";

/** Same minimal Response stand-in as youtube.test.ts. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const REDIRECT_URI = "https://app.example.com/api/auth/youtube/callback";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true";

const oauthOptions = {
  clientId: "client-id",
  clientSecret: "client-secret",
};

describe("buildYouTubeAuthorizeUrl", () => {
  it("targets Google's v2 authorize endpoint with the expected params", () => {
    const url = new URL(buildYouTubeAuthorizeUrl("state-abc", REDIRECT_URI, oauthOptions));

    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-abc");
  });

  it("requests the upload + readonly scopes space-separated", () => {
    const url = new URL(buildYouTubeAuthorizeUrl("state-abc", REDIRECT_URI, oauthOptions));

    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    );
    // The space must be percent-encoded on the wire, never left raw.
    expect(url.toString()).not.toMatch(/scope=[^&]* /);
    expect(url.toString()).toContain("youtube.upload+https");
  });

  it("asks for offline access and forces the consent prompt so a refresh_token is issued", () => {
    const url = new URL(buildYouTubeAuthorizeUrl("state-abc", REDIRECT_URI, oauthOptions));

    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("throws when no client id is configured", () => {
    const previous = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    try {
      expect(() => buildYouTubeAuthorizeUrl("state-abc", REDIRECT_URI)).toThrow(
        /GOOGLE_CLIENT_ID/,
      );
    } finally {
      if (previous !== undefined) process.env.GOOGLE_CLIENT_ID = previous;
    }
  });
});

describe("exchangeYouTubeCode", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  function options(overrides: Record<string, unknown> = {}) {
    return {
      ...oauthOptions,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ...overrides,
    };
  }

  it("exchanges the code and resolves the connected channel id", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00.000Z"));
    try {
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "access-token-1",
          refresh_token: "refresh-token-1",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      );
      fetchImpl.mockResolvedValueOnce(jsonResponse(200, { items: [{ id: "UC-channel-1" }] }));

      const tokens = await exchangeYouTubeCode("auth-code", REDIRECT_URI, options());

      expect(tokens).toEqual({
        accessToken: "access-token-1",
        refreshToken: "refresh-token-1",
        expiresAt: new Date("2026-08-08T13:00:00.000Z"),
        externalAccountId: "UC-channel-1",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0];
      expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
      expect(tokenInit.method).toBe("POST");
      expect(tokenInit.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
      const params = new URLSearchParams(tokenInit.body);
      expect(params.get("grant_type")).toBe("authorization_code");
      expect(params.get("code")).toBe("auth-code");
      expect(params.get("redirect_uri")).toBe(REDIRECT_URI);
      expect(params.get("client_id")).toBe("client-id");
      expect(params.get("client_secret")).toBe("client-secret");

      const [channelsUrl, channelsInit] = fetchImpl.mock.calls[1];
      expect(channelsUrl).toBe(CHANNELS_URL);
      expect(channelsInit.headers.Authorization).toBe("Bearer access-token-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("succeeds with a null refreshToken when Google omits one", async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(200, { access_token: "access-token-1", expires_in: 3600 }),
    );
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { items: [{ id: "UC-channel-1" }] }));

    const tokens = await exchangeYouTubeCode("auth-code", REDIRECT_URI, options());

    expect(tokens.refreshToken).toBeNull();
    expect(tokens.accessToken).toBe("access-token-1");
  });

  it("honours an overridden token url", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { access_token: "a", expires_in: 60 }));
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { items: [{ id: "UC-1" }] }));

    await exchangeYouTubeCode("auth-code", REDIRECT_URI, options({ tokenUrl: "https://fake/token" }));

    expect(fetchImpl.mock.calls[0][0]).toBe("https://fake/token");
  });

  it("throws with the token endpoint's flat error envelope and never looks up channels", async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(400, {
        error: "invalid_grant",
        error_description: "Bad Request",
      }),
    );

    await expect(exchangeYouTubeCode("auth-code", REDIRECT_URI, options())).rejects.toThrow(
      /YouTube code exchange failed \(HTTP 400\): invalid_grant: Bad Request/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws when the token endpoint returns 200 but no access_token", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { token_type: "Bearer" }));

    await expect(exchangeYouTubeCode("auth-code", REDIRECT_URI, options())).rejects.toThrow(
      /returned no access_token/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when the Google account has no YouTube channel", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { access_token: "a", expires_in: 3600 }));
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { items: [] }));

    await expect(exchangeYouTubeCode("auth-code", REDIRECT_URI, options())).rejects.toThrow(
      "No YouTube channel found for this Google account",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("surfaces the nested Data API error envelope from a failed channel lookup", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { access_token: "a", expires_in: 3600 }));
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(403, {
        error: {
          code: 403,
          message: "Request had insufficient authentication scopes.",
          status: "PERMISSION_DENIED",
          errors: [{ reason: "insufficientPermissions", domain: "global" }],
        },
      }),
    );

    await expect(exchangeYouTubeCode("auth-code", REDIRECT_URI, options())).rejects.toThrow(
      /YouTube channel lookup failed \(HTTP 403\): PERMISSION_DENIED: Request had insufficient authentication scopes\./,
    );
  });

  it("throws before any fetch when the OAuth client is not configured", async () => {
    const previousId = process.env.GOOGLE_CLIENT_ID;
    const previousSecret = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    try {
      await expect(
        exchangeYouTubeCode("auth-code", REDIRECT_URI, {
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).rejects.toThrow(/GOOGLE_CLIENT_ID/);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (previousId !== undefined) process.env.GOOGLE_CLIENT_ID = previousId;
      if (previousSecret !== undefined) process.env.GOOGLE_CLIENT_SECRET = previousSecret;
    }
  });
});
