import { log } from "@warlock.js/logger";
import fs from "node:fs/promises";
import path from "node:path";
import type { RequestHandler } from "../../router";
import type { StorageDriverName } from "../../storage/types";
import { HttpError } from "../errors";
import type { Response } from "../response";
import {
  detectImageFormat,
  IMAGE_SIGNATURE_BYTES,
  isVariantSourceFormat,
} from "./detect-image-format";
import { isMissingFileError, variantCacheDirectoryFor } from "./image-variant-cache";
import type { VariantOutputFormat } from "./image-variant-types";
import { localDiskRoot } from "./local-disk-root";
import { matchesIfNoneMatch } from "./matches-if-none-match";
import { parseUploadedFileQuery } from "./parse-uploaded-file-query";
import { readFileHead } from "./read-file-head";
import { resolveImageVariant } from "./resolve-image-variant";
import { resolveInlineImageContentType } from "./resolve-inline-image-content-type";
import { resolveOriginalContentType } from "./resolve-original-content-type";
import { resolveUploadPath } from "./resolve-upload-path";

/**
 * One year, in seconds: originals and derivatives are both long-lived
 */
const ONE_YEAR = 31_536_000;

const CONTENT_TYPES: Record<VariantOutputFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

function notFound(response: Response) {
  return response.notFound({ error: "File Not Found" });
}

async function sendVariant(
  response: Response,
  body: Buffer,
  hash: string,
  format: VariantOutputFormat,
) {
  return response.sendBuffer(body, {
    contentType: CONTENT_TYPES[format],
    cacheTime: ONE_YEAR,
    immutable: true,
    etag: `"${hash}"`,
  });
}

/**
 * Serve an upload original that isn't safe to render inline: a non-raster
 * format (html, xml, the svg family, anything unrecognised) is markup a
 * browser will parse and execute, and a raster-sniffed file whose extension
 * doesn't back that format up (see `resolveInlineImageContentType`) is a
 * polyglot — so both go out as a download instead of a rendered response.
 * `Content-Type` stays extension-derived, except the svg/html/xml family,
 * which is downgraded to `application/octet-stream` so the browser never
 * renders it even if it ignores the disposition.
 */
async function sendOriginalAsAttachment(response: Response, absolutePath: string) {
  response.header("Content-Security-Policy", "sandbox");

  return response.sendBuffer(await fs.readFile(absolutePath), {
    contentType: resolveOriginalContentType(absolutePath),
    cacheTime: ONE_YEAR,
    immutable: true,
    inline: false,
    filename: path.basename(absolutePath),
  });
}

/**
 * Serve an upload original inline, once the sniffed raster format and the
 * extension-derived format have been confirmed to agree. The content type is
 * always the SNIFFED image type, passed explicitly — never `sendFile`'s
 * extension-derived guess, which is exactly what let a JPEG named `.html`
 * out as `text/html` before this existed.
 */
async function sendOriginalInline(response: Response, absolutePath: string, contentType: string) {
  return response.sendBuffer(await fs.readFile(absolutePath), {
    contentType,
    cacheTime: ONE_YEAR,
    immutable: true,
  });
}

/**
 * Options for {@link createUploadedFileController}
 */
export type UploadedFileControllerOptions = {
  /**
   * Local disk to serve from; the default disk when omitted. A private disk
   * should be served from a route that checks access first.
   */
  disk?: StorageDriverName;
};

/**
 * Serves local uploads, and bounded on-demand variants of the images among them.
 *
 * ```ts
 * router.get("/uploads/*", uploadedFileController);
 * router.get("/invoices/*", createUploadedFileController({ disk: "private" }), {
 *   middleware: [authMiddleware()],
 * });
 * ```
 *
 * - `GET /uploads/<path>` sends the original file with a one-year cache.
 * - `GET /uploads/<path>?variant=<name>[&format=webp|avif]` sends a derivative
 *   rendered from a variant named in `uploads.images.variants`. No other query
 *   key is accepted, so a client can never ask for an arbitrary size.
 *
 * The path must stay inside the disk root (after symlinks are resolved) and
 * outside the variant cache; anything else is a 404, the same answer a missing
 * file gets. Derivatives are cached on disk under a directory per source
 * (see `resolveImageVariant`), written atomically, generated once per key even
 * under concurrent requests, and sent with an immutable cache and an ETag.
 */
export function createUploadedFileController(
  options: UploadedFileControllerOptions = {},
): RequestHandler {
  return async ({ request, response }) => {
    const diskRoot = localDiskRoot(options.disk);

    if (!diskRoot) {
      log.error(
        "uploads",
        "serve",
        options.disk === undefined
          ? "uploadedFileController needs a local storage driver with a root."
          : `uploadedFileController needs a local disk; "${options.disk}" is not one.`,
      );

      return notFound(response);
    }

    const query = parseUploadedFileQuery(request.url);

    if (query.type === "invalid") {
      return response.badRequest({ error: query.reason });
    }

    // Every uploads response — originals and variants — tells the browser not
    // to guess a content type from the bytes, so a mislabeled body can never be
    // sniffed into something executable.
    response.header("X-Content-Type-Options", "nosniff");

    if (query.type === "original") {
      const source = await resolveUploadPath(request.params["*"], diskRoot, [
        path.join(diskRoot, ".cache", "image-variants"),
        variantCacheDirectoryFor(diskRoot),
      ]);

      if (!source) return notFound(response);

      // Inline is decided by SNIFFED bytes, never by extension: an svg (or any
      // other non-raster file) named `.png` must still download, not render.
      const head = await readFileHead(source.absolutePath, IMAGE_SIGNATURE_BYTES);
      const sniffedFormat = detectImageFormat(head);

      if (!isVariantSourceFormat(sniffedFormat)) {
        return sendOriginalAsAttachment(response, source.absolutePath);
      }

      // Inline is only safe when the extension-derived type agrees with the
      // sniffed bytes too — otherwise `sendFile` would advertise the
      // extension's type (e.g. text/html for JPEG bytes named `.html`).
      const inlineContentType = resolveInlineImageContentType(source.absolutePath, sniffedFormat);

      if (!inlineContentType) {
        return sendOriginalAsAttachment(response, source.absolutePath);
      }

      return sendOriginalInline(response, source.absolutePath, inlineContentType);
    }

    try {
      const variantInput = {
        path: request.params["*"] as string,
        variant: query.variant,
        ...(query.format !== undefined ? { format: query.format as VariantOutputFormat } : {}),
        ...(options.disk !== undefined ? { disk: options.disk } : {}),
      };
      let variant = await resolveImageVariant(variantInput);

      if (!variant) return notFound(response);

      if (matchesIfNoneMatch(request.header("if-none-match"), `"${variant.hash}"`)) {
        return response.baseResponse.status(304).send();
      }

      let body: Buffer;

      try {
        body = await fs.readFile(variant.absolutePath);
      } catch (readError) {
        if (!isMissingFileError(readError)) throw readError;

        // Pruned between the existence check and the read: the source was
        // rewritten in place and a request for the new version cleared the
        // old generation. Resolve (and render) once more.
        variant = await resolveImageVariant(variantInput);

        if (!variant) return notFound(response);

        body = await fs.readFile(variant.absolutePath);
      }

      return sendVariant(response, body, variant.hash, variant.format);
    } catch (error) {
      if (error instanceof HttpError) {
        return response.send({ error: error.message }, error.status);
      }

      log.error(
        "uploads",
        "variant",
        `Could not generate variant "${query.variant}" of ${String(request.params["*"])}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return response.serverError({ error: "Could not generate the image variant." });
    }
  };
}

/**
 * Serves the default disk's uploads; see {@link createUploadedFileController}
 */
export const uploadedFileController: RequestHandler = createUploadedFileController();
