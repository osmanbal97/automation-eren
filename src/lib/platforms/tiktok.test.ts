import { beforeEach, describe, expect, it, vi } from "vitest";
import { TikTokAdapter, buildTikTokTitle } from "./tiktok";
import {
  PlatformAuthError,
  PlatformNotApprovedError,
  PlatformPublishError,
  type PlatformCredentials,
  type PublishPayload,
} from "./types";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const payload: PublishPayload = {
  videoUrl: "https://blob.example/clip.mp4",
  caption: "a cat helping a human stand up",
  hashtags: ["#cats", "fyp"],
  durationSeconds: 8,
};

const credentials: PlatformCredentials = {
  accessToken: "act.test-access",
  refreshToken: "rft.test-refresh",
  expiresAt: new Date("2026-08-08T00:00:00Z"),
  externalAccountId: "open-id-1",
};

describe("TikTokAdapter", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let adapter: TikTokAdapter;

  beforeEach(() => {
    fetchImpl = vi.fn();
    adapter = new TikTokAdapter({
      clientKey: "test-client-key",
      clientSecret: "test-client-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      now: () => new Date("2026-08-08T12:00:00Z"),
    });
  });

  it("declares the tiktok platform", () => {
    expect(adapter.platform).toBe("tiktok");
  });

  describe("publish", () => {
    it("initializes a PULL_FROM_URL post and returns the publish id", async () => {
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(200, { data: { publish_id: "v_pub_url~v2.123" }, error: { code: "ok" } }),
      );

      const result = await adapter.publish(payload, credentials);

      expect(result).toEqual({ platformPostId: "v_pub_url~v2.123" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe("https://open.tiktokapis.com/v2/post/publish/video/init/");
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer act.test-access");
      expect(JSON.parse(init.body)).toMatchObject({
        post_info: {
          title: "a cat helping a human stand up #cats #fyp",
          privacy_level: "SELF_ONLY",
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: "https://blob.example/clip.mp4",
        },
      });
    });

    it("pins privacy to SELF_ONLY pre-audit even when a public level is configured", async () => {
      const sandboxed = new TikTokAdapter({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async () => {},
        privacyLevel: "PUBLIC_TO_EVERYONE",
      });
      fetchImpl.mockResolvedValueOnce(jsonResponse(200, { data: { publish_id: "p1" } }));

      expect(sandboxed.privacyLevel).toBe("SELF_ONLY");
      await sandboxed.publish(payload, credentials);

      expect(JSON.parse(fetchImpl.mock.calls[0][1].body).post_info.privacy_level).toBe("SELF_ONLY");
    });

    it("uses the configured privacy level once the app has passed audit", async () => {
      const approved = new TikTokAdapter({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async () => {},
        auditPassed: true,
        privacyLevel: "PUBLIC_TO_EVERYONE",
      });
      fetchImpl.mockResolvedValueOnce(jsonResponse(200, { data: { publish_id: "p1" } }));

      await approved.publish(payload, credentials);

      expect(JSON.parse(fetchImpl.mock.calls[0][1].body).post_info.privacy_level).toBe(
        "PUBLIC_TO_EVERYONE",
      );
    });

    it("backs off on a 429 and succeeds on the retry", async () => {
      fetchImpl
        .mockResolvedValueOnce(jsonResponse(429, { error: { code: "rate_limit_exceeded" } }))
        .mockResolvedValueOnce(jsonResponse(200, { data: { publish_id: "v_pub_url~v2.456" } }));

      const result = await adapter.publish(payload, credentials);

      expect(result.platformPostId).toBe("v_pub_url~v2.456");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("treats an HTTP 200 rate-limit envelope as retryable", async () => {
      fetchImpl
        .mockResolvedValueOnce(jsonResponse(200, { error: { code: "rate_limit_exceeded" } }))
        .mockResolvedValueOnce(jsonResponse(200, { data: { publish_id: "v_pub_url~v2.789" } }));

      const result = await adapter.publish(payload, credentials);

      expect(result.platformPostId).toBe("v_pub_url~v2.789");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("surfaces PlatformNotApprovedError when the app has not passed audit", async () => {
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(403, {
          error: {
            code: "unaudited_client_can_only_post_to_private_accounts",
            message: "app is unaudited",
          },
        }),
      );

      await expect(adapter.publish(payload, credentials)).rejects.toThrow(PlatformNotApprovedError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("surfaces PlatformAuthError for a revoked/insufficient-scope token", async () => {
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(401, { error: { code: "scope_not_authorized", message: "missing video.publish" } }),
      );

      await expect(adapter.publish(payload, credentials)).rejects.toThrow(PlatformAuthError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("surfaces PlatformPublishError on a hard 400 failure", async () => {
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(400, { error: { code: "invalid_file_upload", message: "video_url unreachable" } }),
      );

      await expect(adapter.publish(payload, credentials)).rejects.toThrow(PlatformPublishError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("surfaces PlatformPublishError when TikTok accepts the init but omits publish_id", async () => {
      fetchImpl.mockResolvedValueOnce(jsonResponse(200, { data: {}, error: { code: "ok" } }));

      await expect(adapter.publish(payload, credentials)).rejects.toThrow(/no publish_id/);
    });

    it("gives up after exhausting retries on persistent 5xx", async () => {
      fetchImpl.mockResolvedValue(jsonResponse(503, {}));

      await expect(adapter.publish(payload, credentials)).rejects.toThrow(/failed after 4 attempt\(s\)/);
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    });
  });

  describe("refreshCredentials", () => {
    it("exchanges an expired token for new credentials with a computed expiry", async () => {
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "act.new-access",
          refresh_token: "rft.new-refresh",
          expires_in: 86400,
          open_id: "open-id-1",
        }),
      );

      const refreshed = await adapter.refreshCredentials(credentials);

      expect(refreshed).toEqual({
        accessToken: "act.new-access",
        refreshToken: "rft.new-refresh",
        expiresAt: new Date("2026-08-09T12:00:00Z"),
      });

      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
      expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
      const form = new URLSearchParams(init.body as string);
      expect(form.get("grant_type")).toBe("refresh_token");
      expect(form.get("refresh_token")).toBe("rft.test-refresh");
      expect(form.get("client_key")).toBe("test-client-key");
    });

    it("keeps the existing refresh token when TikTok does not rotate it", async () => {
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(200, { access_token: "act.new-access", expires_in: 86400 }),
      );

      const refreshed = await adapter.refreshCredentials(credentials);

      expect(refreshed.refreshToken).toBe("rft.test-refresh");
    });

    it("throws PlatformAuthError when the refresh token itself is rejected", async () => {
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(400, { error: "invalid_grant", error_description: "refresh token expired" }),
      );

      await expect(adapter.refreshCredentials(credentials)).rejects.toThrow(PlatformAuthError);
    });

    it("throws PlatformAuthError when there is no stored refresh token", async () => {
      await expect(
        adapter.refreshCredentials({ accessToken: "act.x", refreshToken: null }),
      ).rejects.toThrow(PlatformAuthError);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("throws when the OAuth app credentials are not configured", async () => {
      const unconfigured = new TikTokAdapter({
        clientKey: undefined,
        clientSecret: undefined,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      await expect(unconfigured.refreshCredentials(credentials)).rejects.toThrow(
        /TIKTOK_CLIENT_KEY/,
      );
    });
  });

  describe("buildTikTokTitle", () => {
    it("normalizes hashtags and appends them to the caption", () => {
      expect(buildTikTokTitle("hello world", ["#one", "two", "  "])).toBe("hello world #one #two");
    });

    it("truncates to TikTok's title limit", () => {
      expect(buildTikTokTitle("x".repeat(3000), []).length).toBe(2200);
    });
  });
});
