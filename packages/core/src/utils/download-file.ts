import crypto from "crypto";
import { writeFile } from "fs/promises";
import path from "path";
import { safeFetchToBuffer, type SafeFetchOptions } from "../storage/utils/safe-fetch";

export type DownloadFileOptions = Pick<
  SafeFetchOptions,
  "maxBytes" | "timeoutMs" | "allowPrivateHosts" | "allowedSchemes"
>;

const contentTypeExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/json": "json",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
};

/**
 * Download a file from a URL (SSRF-guarded, size and time limited) into a directory.
 * The extension comes from `fileName` if it has one, otherwise from the URL pathname,
 * otherwise from the response Content-Type.
 */
export async function downloadFileFromUrl(
  fileUrl: string,
  outputLocationPath: string,
  fileName?: string,
  options: DownloadFileOptions = {},
): Promise<void> {
  const response = await safeFetchToBuffer(fileUrl, options);

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
      const mime = response.contentType?.split(";")[0].trim().toLowerCase();
      const fromMime = mime ? contentTypeExtensions[mime] : undefined;
      extension = fromMime ? `.${fromMime}` : "";
    }

    name += extension;
  }

  await writeFile(path.join(outputLocationPath, name), response.buffer);
}
