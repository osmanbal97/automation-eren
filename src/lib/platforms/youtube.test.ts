import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuotaExceededError, type QuotaStore } from "@/lib/quota";
import {
  YOUTUBE_UPLOAD_QUOTA_UNITS,
  YouTubeAdapter,
  YouTubeQuotaExceededError,
} from "./youtube";
import {
  PlatformAuthError,
  PlatformNotApprovedError,
  PlatformPublishError,
  type PublishPayload,
} from "./types";

/** Mirrors quota.test.ts's fake, plus a spy so we can assert recordUsage's units. */
function createFakeQuotaStore(initial: Record<string, number> = {}) {
  const usage = new Map(Object.entries(initial));
  const key = (provider: string, date: string) => `${provider}::${date}`;
  const incrementUsage = vi.fn(async (provider: string, date: string, units: number) => {
    usage.set(key(provider, date), (usage.get(key(provider, date)) ?? 0) + units);
  });
  const store: QuotaStore = {
    async getUsage(provider, date) {
      return usage.get(key(provider, date)) ?? 0;
    },
    incrementUsage,
  };
  return { store, incrementUsage, usage };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function videoBytesResponse(byteLength = 1024): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(byteLength),
  } as unknown as Response;
}

const TODAY = new Date().toISOString().slice(0, 10);
const UPLOAD_URL = "https://upload.googleapis.com/resumable/session-abc";

const payload: PublishPayload = {
  videoUrl: "https://blob.example/short.mp4",
  caption: "Cat helps human stand up\nThe full story below.",
  hashtags: ["#cats", "wholesome"],
  durationSeconds: 22,
};

const credentials = {
  accessToken: "access-token-1",
  refreshToken: "refresh-token-1",
};

describe("YouTubeAdapter", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  function createAdapter(
    quotaStore: QuotaStore,
    overrides: Partial<ConstructorParameters<typeof YouTubeAdapter>[0]> = {},
  ) {
    return new YouTubeAdapter({
      quotaStore,
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      random: () => 0,
      now: () => new Date("2026-08-08T12:00:00.000Z"),
      ...overrides,
    });
  }

  /** download -> resumable init (Location header) -> PUT bytes (created resource). */
  function mockHappyPathUpload(videoId = "yt-video-123") {
    fetchImpl.mockResolvedValueOnce(videoBytesResponse(2048));
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, {}, { Location: UPLOAD_URL }));
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { id: videoId }));
  }

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  describe("publish", () => {
    it("runs the resumable upload and returns the created video id", async () => {
      const { store } = createFakeQuotaStore();
      mockHappyPathUpload("yt-video-123");

      const result = await createAdapter(store).publish(payload, credentials);

      expect(result).toEqual({ platformPostId: "yt-video-123" });
      expect(fetchImpl).toHaveBeenCalledTimes(3);

      const [downloadUrl] = fetchImpl.mock.calls[0];
      expect(downloadUrl).toBe("https://blob.example/short.mp4");

      const [initUrl, initInit] = fetchImpl.mock.calls[1];
      expect(initUrl).toBe(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      );
      expect(initInit.method).toBe("POST");
      expect(initInit.headers.Authorization).toBe("Bearer access-token-1");
      expect(initInit.headers["X-Upload-Content-Length"]).toBe("2048");
      expect(JSON.parse(initInit.body)).toMatchObject({
        snippet: {
          title: "Cat helps human stand up",
          description: "Cat helps human stand up\nThe full story below.",
          tags: ["cats", "wholesome"],
        },
        status: { privacyStatus: "public" },
      });

      const [putUrl, putInit] = fetchImpl.mock.calls[2];
      expect(putUrl).toBe(UPLOAD_URL);
      expect(putInit.method).toBe("PUT");
      expect(putInit.headers["Content-Type"]).toBe("video/mp4");
    });

    it("records 1600 units against the youtube quota after a successful upload", async () => {
      const { store, incrementUsage } = createFakeQuotaStore();
      mockHappyPathUpload();

      await createAdapter(store).publish(payload, credentials);

      expect(incrementUsage).toHaveBeenCalledTimes(1);
      expect(incrementUsage).toHaveBeenCalledWith("youtube", TODAY, YOUTUBE_UPLOAD_QUOTA_UNITS);
      expect(YOUTUBE_UPLOAD_QUOTA_UNITS).toBe(1600);
    });

    it("blocks the upload on the quota pre-check without calling fetch at all", async () => {
      const { store, incrementUsage } = createFakeQuotaStore({ [`youtube::${TODAY}`]: 8401 });

      await expect(createAdapter(store).publish(payload, credentials)).rejects.toThrow(
        QuotaExceededError,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(incrementUsage).not.toHaveBeenCalled();
    });

    it("allows an upload that lands exactly on the daily cap", async () => {
      const { store } = createFakeQuotaStore({ [`youtube::${TODAY}`]: 8400 });
      mockHappyPathUpload();

      await expect(createAdapter(store).publish(payload, credentials)).resolves.toEqual({
        platformPostId: "yt-video-123",
      });
    });

    it("surfaces a 403 quotaExceeded from YouTube as a distinct YouTubeQuotaExceededError", async () => {
      const { store, incrementUsage } = createFakeQuotaStore();
      fetchImpl.mockResolvedValueOnce(videoBytesResponse());
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(403, {
          error: {
            code: 403,
            message: "The request cannot be completed because you have exceeded your quota.",
            errors: [{ reason: "quotaExceeded", domain: "youtube.quota" }],
          },
        }),
      );

      const error = await createAdapter(store)
        .publish(payload, credentials)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(YouTubeQuotaExceededError);
      expect(error).not.toBeInstanceOf(PlatformPublishError);
      expect((error as YouTubeQuotaExceededError).reason).toBe("quotaExceeded");
      // The 403 is terminal, so it must not be retried and must not be billed.
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(incrementUsage).not.toHaveBeenCalled();
    });

    it("throws PlatformAuthError when YouTube rejects the access token with a 401", async () => {
      const { store, incrementUsage } = createFakeQuotaStore();
      fetchImpl.mockResolvedValueOnce(videoBytesResponse());
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(401, {
          error: { code: 401, message: "Invalid Credentials", errors: [{ reason: "authError" }] },
        }),
      );

      await expect(createAdapter(store).publish(payload, credentials)).rejects.toThrow(
        PlatformAuthError,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(incrementUsage).not.toHaveBeenCalled();
    });

    it("maps a 403 youtubeSignupRequired onto PlatformNotApprovedError", async () => {
      const { store } = createFakeQuotaStore();
      fetchImpl.mockResolvedValueOnce(videoBytesResponse());
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(403, {
          error: { code: 403, errors: [{ reason: "youtubeSignupRequired" }] },
        }),
      );

      await expect(createAdapter(store).publish(payload, credentials)).rejects.toThrow(
        PlatformNotApprovedError,
      );
    });

    it("throws PlatformPublishError on a hard 400 from the resumable init", async () => {
      const { store, incrementUsage } = createFakeQuotaStore();
      fetchImpl.mockResolvedValueOnce(videoBytesResponse());
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(400, { error: { code: 400, message: "Invalid snippet.title" } }),
      );

      await expect(createAdapter(store).publish(payload, credentials)).rejects.toThrow(
        PlatformPublishError,
      );
      expect(incrementUsage).not.toHaveBeenCalled();
    });

    it("fails clearly when the resumable init returns no Location header", async () => {
      const { store } = createFakeQuotaStore();
      fetchImpl.mockResolvedValueOnce(videoBytesResponse());
      fetchImpl.mockResolvedValueOnce(jsonResponse(200, {}));

      await expect(createAdapter(store).publish(payload, credentials)).rejects.toThrow(
        /no Location upload URL/,
      );
    });

    it("fails clearly when the completed upload returns no video id", async () => {
      const { store, incrementUsage } = createFakeQuotaStore();
      fetchImpl.mockResolvedValueOnce(videoBytesResponse());
      fetchImpl.mockResolvedValueOnce(jsonResponse(200, {}, { Location: UPLOAD_URL }));
      fetchImpl.mockResolvedValueOnce(jsonResponse(200, {}));

      await expect(createAdapter(store).publish(payload, credentials)).rejects.toThrow(
        /returned no video id/,
      );
      expect(incrementUsage).not.toHaveBeenCalled();
    });

    it("retries transient 5xx responses and gives up after the retry budget", async () => {
      const { store, incrementUsage } = createFakeQuotaStore();
      fetchImpl.mockResolvedValueOnce(videoBytesResponse());
      fetchImpl.mockResolvedValue(jsonResponse(503, {}));

      await expect(
        createAdapter(store, { maxAttempts: 3 }).publish(payload, credentials),
      ).rejects.toThrow(/failed after 3 attempt\(s\)/);
      // 1 download + 3 init attempts.
      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect(incrementUsage).not.toHaveBeenCalled();
    });

    it("fails with PlatformPublishError if the source video cannot be downloaded", async () => {
      const { store } = createFakeQuotaStore();
      fetchImpl.mockResolvedValueOnce(jsonResponse(404, {}));

      await expect(createAdapter(store).publish(payload, credentials)).rejects.toThrow(
        /Could not fetch the source video/,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe("refreshCredentials", () => {
    it("exchanges the refresh token and computes expiresAt from expires_in", async () => {
      const { store } = createFakeQuotaStore();
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(200, { access_token: "access-token-2", expires_in: 3600 }),
      );

      const refreshed = await createAdapter(store).refreshCredentials(credentials);

      expect(refreshed).toEqual({
        accessToken: "access-token-2",
        refreshToken: "refresh-token-1",
        expiresAt: new Date("2026-08-08T13:00:00.000Z"),
      });

      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe("https://oauth2.googleapis.com/token");
      const params = new URLSearchParams(init.body);
      expect(params.get("grant_type")).toBe("refresh_token");
      expect(params.get("refresh_token")).toBe("refresh-token-1");
      expect(params.get("client_id")).toBe("client-id");
    });

    it("carries a rotated refresh token forward when Google sends one", async () => {
      const { store } = createFakeQuotaStore();
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "access-token-2",
          refresh_token: "refresh-token-2",
          expires_in: 3600,
        }),
      );

      const refreshed = await createAdapter(store).refreshCredentials(credentials);

      expect(refreshed.refreshToken).toBe("refresh-token-2");
    });

    it("throws PlatformAuthError when the refresh token has been revoked", async () => {
      const { store } = createFakeQuotaStore();
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }),
      );

      await expect(createAdapter(store).refreshCredentials(credentials)).rejects.toThrow(
        PlatformAuthError,
      );
    });

    it("throws PlatformAuthError without calling fetch when there is no stored refresh token", async () => {
      const { store } = createFakeQuotaStore();

      await expect(
        createAdapter(store).refreshCredentials({ accessToken: "a", refreshToken: null }),
      ).rejects.toThrow(PlatformAuthError);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("throws PlatformAuthError when the Google OAuth client is not configured", async () => {
      const { store } = createFakeQuotaStore();
      const adapter = createAdapter(store, { clientId: "", clientSecret: "" });

      await expect(adapter.refreshCredentials(credentials)).rejects.toThrow(
        /GOOGLE_CLIENT_ID/,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  it("identifies itself as the youtube platform", () => {
    const { store } = createFakeQuotaStore();
    expect(createAdapter(store).platform).toBe("youtube");
  });
});
