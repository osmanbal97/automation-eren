import { beforeEach, describe, expect, it, vi } from "vitest";
import { INSTAGRAM_REELS_MAX_DURATION_SECONDS, InstagramAdapter } from "./instagram";
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

const credentials: PlatformCredentials = {
  accessToken: "test-token",
  externalAccountId: "17841400000000000",
};

const payload: PublishPayload = {
  videoUrl: "https://blob.example/reel.mp4",
  caption: "a cat helping a human stand up",
  hashtags: ["cats", "#wholesome"],
  durationSeconds: 32,
};

function formBody(init: RequestInit): URLSearchParams {
  return new URLSearchParams(init.body as string);
}

describe("InstagramAdapter", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let adapter: InstagramAdapter;

  beforeEach(() => {
    fetchImpl = vi.fn();
    adapter = new InstagramAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      maxPolls: 3,
      pollIntervalMs: 1,
    });
  });

  it("exposes the instagram platform key", () => {
    expect(adapter.platform).toBe("instagram");
  });

  it("publishes a reel through create -> poll -> publish and returns the media id", async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(200, { id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "IN_PROGRESS" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "media-99" }));

    const result = await adapter.publish(payload, credentials);

    expect(result).toEqual({ platformPostId: "media-99" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    const [createUrl, createInit] = fetchImpl.mock.calls[0];
    expect(createUrl).toBe(
      "https://graph.facebook.com/v21.0/17841400000000000/media",
    );
    expect(createInit.method).toBe("POST");
    const createParams = formBody(createInit);
    expect(createParams.get("media_type")).toBe("REELS");
    expect(createParams.get("video_url")).toBe("https://blob.example/reel.mp4");
    expect(createParams.get("caption")).toBe(
      "a cat helping a human stand up #cats #wholesome",
    );
    expect(createParams.get("access_token")).toBe("test-token");

    const [statusUrl, statusInit] = fetchImpl.mock.calls[1];
    expect(statusUrl).toContain("https://graph.facebook.com/v21.0/container-1?");
    expect(statusUrl).toContain("fields=status_code");
    expect(statusInit.method).toBe("GET");

    const [publishUrl, publishInit] = fetchImpl.mock.calls[3];
    expect(publishUrl).toBe(
      "https://graph.facebook.com/v21.0/17841400000000000/media_publish",
    );
    expect(publishInit.method).toBe("POST");
    expect(formBody(publishInit).get("creation_id")).toBe("container-1");
  });

  it("rejects videos longer than 90 seconds without making any API call", async () => {
    await expect(
      adapter.publish(
        { ...payload, durationSeconds: INSTAGRAM_REELS_MAX_DURATION_SECONDS + 1 },
        credentials,
      ),
    ).rejects.toThrow(/limited to 90 seconds/);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a video exactly at the 90 second limit", async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(200, { id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "media-90" }));

    const result = await adapter.publish(
      { ...payload, durationSeconds: INSTAGRAM_REELS_MAX_DURATION_SECONDS },
      credentials,
    );

    expect(result.platformPostId).toBe("media-90");
  });

  it("throws a bounded timeout error when the container never finishes", async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(200, { id: "container-1" }))
      .mockResolvedValue(jsonResponse(200, { status_code: "IN_PROGRESS" }));

    await expect(adapter.publish(payload, credentials)).rejects.toThrow(
      /did not reach FINISHED within 3 polls/,
    );

    // 1 create + exactly maxPolls status checks, then it gives up. No publish call.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("throws when the container itself lands in ERROR", async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(200, { id: "container-1" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { status_code: "ERROR", status: "Media download failed" }),
      );

    await expect(adapter.publish(payload, credentials)).rejects.toThrow(
      /ended in ERROR: Media download failed/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws PlatformPublishError when the media_publish step fails", async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(200, { id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "FINISHED" }))
      .mockResolvedValueOnce(
        jsonResponse(400, { error: { message: "Media ID is not available", code: 9007 } }),
      );

    const error = await adapter.publish(payload, credentials).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlatformPublishError);
    expect((error as PlatformPublishError).operation).toBe("mediaPublish");
    expect((error as PlatformPublishError).status).toBe(400);
    expect((error as Error).message).toMatch(/Media ID is not available/);
  });

  it("throws PlatformNotApprovedError when a publishing permission is missing", async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(403, {
        error: {
          message: "(#200) Requires instagram_content_publish permission",
          code: 200,
        },
      }),
    );

    const error = await adapter.publish(payload, credentials).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlatformNotApprovedError);
    expect((error as Error).message).toMatch(/pending permissions\/app review/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws PlatformAuthError on an expired/invalid access token", async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(401, {
        error: { message: "Error validating access token: Session has expired", code: 190 },
      }),
    );

    const error = await adapter.publish(payload, credentials).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlatformAuthError);
    expect((error as Error).message).toMatch(/rejected the access token/);
  });

  it("throws PlatformAuthError before any call when the IG user id is missing", async () => {
    await expect(
      adapter.publish(payload, { accessToken: "test-token" }),
    ).rejects.toThrow(PlatformAuthError);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries transient 5xx responses through callWithRetry", async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "media-99" }));

    const result = await adapter.publish(payload, credentials);

    expect(result.platformPostId).toBe("media-99");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("surfaces a container response with no id as a publish error", async () => {
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, {}));

    await expect(adapter.publish(payload, credentials)).rejects.toThrow(
      /returned no container id/,
    );
  });
});
