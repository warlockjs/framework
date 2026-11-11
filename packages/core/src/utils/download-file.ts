import crypto from "crypto";
import { writeFile } from "fs/promises";
import path from "path";
import { safeFetchToBuffer, type SafeFetchOptions } from "../storage/utils/safe-fetch";

export type DownloadFileOptions = Pick<
  SafeFetchOptions,
  "maxBytes" | "timeoutMs" | "allowPrivateHosts" | "allowedSchemes"
> & {
  /**
   * Extensions (without the dot, case-insensitive) the saved file may take from
   * the URL or the response Content-Type when `fileName` has no extension of its
   * own. Any other extension is replaced by `.bin`, so a remote server cannot
   * make the file land as `.html`, `.svg` or `.js`.
   *
   * Default: common image, document, archive, audio and video types
   * (`png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `pdf`, `txt`, `csv`, `json`,
   * `zip`, `mp3`, `mp4`, …). Markup and script types are never in the default.
   */
  allowedExtensions?: string[];
};

/**
 * Extensions a downloaded file may take from the remote side by default.
 * Nothing a browser renders as active content (HTML, SVG, XML, scripts).
 */
const DEFAULT_ALLOWED_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "tif",
  "tiff",
  "pdf",
  "txt",
  "csv",
  "json",
  "zip",
  "gz",
  "tar",
  "mp3",
  "m4a",
  "wav",
  "ogg",
  "mp4",
  "webm",
  "mov",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
];

/** Extension used when the remote one is not allowed. */
const FALLBACK_EXTENSION = ".bin";

const contentTypeExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/json": "json",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
};

/**
 * Download a file from a URL (SSRF-guarded, size and time limited) into a directory.
 * The extension comes from `fileName` if it has one, otherwise from the URL pathname,
 * otherwise from the response Content-Type. An extension taken from the URL or the
 * Content-Type must be in `options.allowedExtensions`; anything else is saved as `.bin`.
 */
export async function downloadFileFromUrl(
  fileUrl: string,
  outputLocationPath: string,
  fileName?: string,
  options: DownloadFileOptions = {},
): Promise<void> {
  const { allowedExtensions = DEFAULT_ALLOWED_EXTENSIONS, ...fetchOptions } = options;
  const response = await safeFetchToBuffer(fileUrl, fetchOptions);

  if (!response.ok) {
    throw new Error(
      `Failed to download file from "${fileUrl}": ${response.status} ${response.statusText}`,
    );
  }

  let name = fileName ? path.basename(fileName) : crypto.randomBytes(16).toString("hex");

  if (!path.extname(name)) {
    let extension = "";

    try {
      extension = path.extname(new URL(fileUrl).pathname);
    } catch {
      // invalid URL is already rejected by the fetch guard
    }

    if (!extension) {
      const mime = response.contentType?.split(";")[0]?.trim().toLowerCase();
      const fromMime = mime ? contentTypeExtensions[mime] : undefined;
      extension = fromMime ? `.${fromMime}` : "";
    }

    const allowed = new Set(allowedExtensions.map((item) => item.replace(/^\./, "").toLowerCase()));

    if (extension && !allowed.has(extension.slice(1).toLowerCase())) {
      extension = FALLBACK_EXTENSION;
    }

    name += extension;
  }

  await writeFile(path.join(outputLocationPath, name), response.buffer);
}
