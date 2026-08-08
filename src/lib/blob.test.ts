import { beforeEach, describe, expect, it, vi } from "vitest";

const { putMock, headMock, delMock } = vi.hoisted(() => ({
  putMock: vi.fn(),
  headMock: vi.fn(),
  delMock: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  put: putMock,
  head: headMock,
  del: delMock,
}));

import { deleteFile, getFileUrl, uploadFile } from "./blob";

describe("blob helper", () => {
  beforeEach(() => {
    putMock.mockReset();
    headMock.mockReset();
    delMock.mockReset();
  });

  describe("uploadFile", () => {
    it("uploads a buffer and returns url/pathname/contentType/size", async () => {
      putMock.mockResolvedValue({
        url: "https://blob.example.com/videos/clip-abc123.mp4",
        pathname: "videos/clip-abc123.mp4",
        contentType: "video/mp4",
      });

      const body = Buffer.from("fake video bytes");
      const result = await uploadFile("videos/clip.mp4", body, { contentType: "video/mp4" });

      expect(putMock).toHaveBeenCalledWith(
        "videos/clip.mp4",
        body,
        expect.objectContaining({ access: "public", contentType: "video/mp4", addRandomSuffix: true }),
      );
      expect(result).toEqual({
        url: "https://blob.example.com/videos/clip-abc123.mp4",
        pathname: "videos/clip-abc123.mp4",
        contentType: "video/mp4",
        sizeBytes: body.byteLength,
      });
      expect(headMock).not.toHaveBeenCalled();
    });

    it("defaults to public access when none is provided", async () => {
      putMock.mockResolvedValue({
        url: "https://blob.example.com/thumbs/a.png",
        pathname: "thumbs/a.png",
        contentType: null,
      });

      await uploadFile("thumbs/a.png", "hello");

      expect(putMock).toHaveBeenCalledWith(
        "thumbs/a.png",
        "hello",
        expect.objectContaining({ access: "public" }),
      );
    });

    it("falls back to head() for size when the body is a stream", async () => {
      putMock.mockResolvedValue({
        url: "https://blob.example.com/videos/stream.mp4",
        pathname: "videos/stream.mp4",
        contentType: "video/mp4",
      });
      headMock.mockResolvedValue({ size: 4096 });

      const stream = new ReadableStream();
      const result = await uploadFile("videos/stream.mp4", stream, { contentType: "video/mp4" });

      expect(headMock).toHaveBeenCalledWith("https://blob.example.com/videos/stream.mp4");
      expect(result.sizeBytes).toBe(4096);
    });
  });

  describe("getFileUrl", () => {
    it("returns the url from blob metadata", async () => {
      headMock.mockResolvedValue({ url: "https://blob.example.com/videos/clip.mp4", size: 123 });

      const url = await getFileUrl("https://blob.example.com/videos/clip.mp4");

      expect(url).toBe("https://blob.example.com/videos/clip.mp4");
      expect(headMock).toHaveBeenCalledWith("https://blob.example.com/videos/clip.mp4");
    });
  });

  describe("deleteFile", () => {
    it("delegates to del()", async () => {
      delMock.mockResolvedValue(undefined);

      await deleteFile("https://blob.example.com/videos/clip.mp4");

      expect(delMock).toHaveBeenCalledWith("https://blob.example.com/videos/clip.mp4");
    });
  });
});
