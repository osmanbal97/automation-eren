import { del, head, put } from "@vercel/blob";

export interface UploadFileOptions {
  /** MIME type of the file being uploaded, e.g. "video/mp4". */
  contentType?: string;
  /** Vercel Blob access level. Defaults to "public" (personal-use dashboard, no need for signed URLs). */
  access?: "public";
}

export interface UploadFileResult {
  /** Public URL of the stored blob — this is what gets persisted on videos.blobUrl / videos.thumbnailBlobUrl. */
  url: string;
  /** Storage path/key within the blob store. */
  pathname: string;
  contentType: string | null;
  sizeBytes: number;
}

type UploadableBody = ArrayBuffer | Buffer | Blob | ReadableStream | string;

/**
 * Uploads a file (video, thumbnail, etc.) to Vercel Blob and returns enough
 * metadata to populate the `videos` table (url, size, content type).
 */
export async function uploadFile(
  pathname: string,
  body: UploadableBody,
  options: UploadFileOptions = {},
): Promise<UploadFileResult> {
  const result = await put(pathname, body, {
    access: options.access ?? "public",
    contentType: options.contentType,
    addRandomSuffix: true,
  });

  const sizeBytes = await resolveSizeBytes(body, result.url);

  return {
    url: result.url,
    pathname: result.pathname,
    contentType: result.contentType ?? options.contentType ?? null,
    sizeBytes,
  };
}

async function resolveSizeBytes(body: UploadableBody, url: string): Promise<number> {
  if (typeof body === "string") {
    return new TextEncoder().encode(body).byteLength;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return body.size;
  }
  // Streams don't expose a length up front — ask the blob store for it after upload.
  const metadata = await head(url);
  return metadata.size;
}

/**
 * Looks up the current metadata for a previously-uploaded blob and returns
 * its (possibly refreshed) public URL. Also useful as an existence check
 * before scheduling/publishing a video.
 */
export async function getFileUrl(url: string): Promise<string> {
  const metadata = await head(url);
  return metadata.url;
}

/** Deletes a stored blob (e.g. a rejected video and its thumbnail). */
export async function deleteFile(url: string): Promise<void> {
  await del(url);
}
