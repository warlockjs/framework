import { log } from "@warlock.js/logger";
import fs from "node:fs/promises";
import type { RequestHandler } from "../../router";
import { storage } from "../../storage";
import { HttpError } from "../errors";
import type { Response } from "../response";
import { uploadsConfig } from "../uploads-config";
import { generateImageVariant } from "./generate-image-variant";
import type { VariantOutputFormat } from "./image-variant-types";
import { loadVariantSource } from "./load-variant-source";
import { matchesIfNoneMatch } from "./matches-if-none-match";
import { parseUploadedFileQuery } from "./parse-uploaded-file-query";
import { resolveImageVariantsConfig } from "./resolve-image-variants-config";
import { resolveUploadPath, type ResolvedUploadPath } from "./resolve-upload-path";
import { resolveVariantCandidate } from "./resolve-variant-candidate";
import { variantCacheKey, variantCachePath } from "./variant-cache-key";
import { variantGenerations } from "./variant-generations";

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

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);

    return true;
  } catch {
    return false;
  }
}

function notFound(response: Response) {
  return response.notFound({ error: "File Not Found" });
}

async function sendVariant(
  response: Response,
  target: string,
  hash: string,
  format: VariantOutputFormat,
) {
  return response.sendBuffer(await fs.readFile(target), {
    contentType: CONTENT_TYPES[format],
    cacheTime: ONE_YEAR,
    immutable: true,
    etag: `"${hash}"`,
  });
}

/**
 * Serves local uploads, and bounded on-demand variants of the images among them.
 *
 * ```ts
 * router.get("/uploads/*", uploadedFileController);
 * ```
 *
 * - `GET /uploads/<path>` sends the original file with a one-year cache.
 * - `GET /uploads/<path>?variant=<name>[&format=webp|avif]` sends a derivative
 *   rendered from a variant named in `uploads.images.variants`. No other query
 *   key is accepted, so a client can never ask for an arbitrary size.
 *
 * The path must stay inside the storage root (after symlinks are resolved) and
 * outside the variant cache; anything else is a 404, the same answer a missing
 * file gets. Derivatives are cached on disk under a sha256 of the source path,
 * size, mtime, variant and format, written atomically, generated once per key
 * even under concurrent requests, and sent with an immutable cache and an ETag.
 */
export const uploadedFileController: RequestHandler = async ({ request, response }) => {
  const storageRoot = storage.root();

  if (!storageRoot || storageRoot === ".") {
    log.error(
      "uploads",
      "serve",
      "uploadedFileController needs a local storage driver with a root.",
    );

    return notFound(response);
  }

  const query = parseUploadedFileQuery(request.url);

  if (query.type === "invalid") {
    return response.badRequest({ error: query.reason });
  }

  if (query.type === "original") {
    const images = uploadsConfig("images");
    const cacheDirectory = images?.cacheDirectory ? [images.cacheDirectory] : [];
    const source = await resolveUploadPath(request.params["*"], storageRoot, [
      storage.root(".cache/image-variants"),
      ...cacheDirectory,
    ]);

    if (!source) return notFound(response);

    return response.sendFile(source.absolutePath, ONE_YEAR);
  }

  const images = resolveImageVariantsConfig(uploadsConfig("images"), storageRoot);

  if (!images) {
    return response.badRequest({ error: "Image variants are not configured." });
  }

  if (!Object.prototype.hasOwnProperty.call(images.variants, query.variant)) {
    return response.badRequest({ error: `Unknown variant "${query.variant}".` });
  }

  const requestedFormat = query.format as VariantOutputFormat | undefined;

  if (requestedFormat !== undefined && !images.formats.includes(requestedFormat as never)) {
    return response.badRequest({ error: `Format "${query.format}" is not allowed.` });
  }

  const variant = images.variants[query.variant];

  let source: ResolvedUploadPath | undefined;

  try {
    const candidate = await resolveVariantCandidate(request.params["*"], storageRoot, images);

    if (!candidate) return notFound(response);

    const resolvedSource = candidate.source;

    source = resolvedSource;

    const { stats, sourceFormat } = candidate;
    const format: VariantOutputFormat = requestedFormat ?? sourceFormat;
    const hash = variantCacheKey({
      relativePath: resolvedSource.relativePath,
      sourceSize: stats.size,
      sourceMtimeMs: stats.mtimeMs,
      variant,
      format,
    });
    const target = variantCachePath(images.cacheDirectory, hash, format);

    if (await exists(target)) {
      if (matchesIfNoneMatch(request.header("if-none-match"), `"${hash}"`)) {
        return response.baseResponse.status(304).send();
      }

      return sendVariant(response, target, hash, format);
    }

    await variantGenerations.run(hash, async () => {
      if (await exists(target)) return;

      const image = await loadVariantSource(resolvedSource.absolutePath, {
        maxSourceBytes: images.maxSourceBytes,
        maxSourcePixels: images.maxSourcePixels,
        expectedFormat: sourceFormat,
      });

      await generateImageVariant({ image, variant, format, targetPath: target });
    });

    return sendVariant(response, target, hash, format);
  } catch (error) {
    if (error instanceof HttpError) {
      return response.send({ error: error.message }, error.status);
    }

    log.error(
      "uploads",
      "variant",
      `Could not generate variant "${query.variant}" of ${source?.relativePath ?? request.params["*"]}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return response.serverError({ error: "Could not generate the image variant." });
  }
};
