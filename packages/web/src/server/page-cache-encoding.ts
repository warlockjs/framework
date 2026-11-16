import { createHash } from "node:crypto";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { config } from "@warlock.js/core";

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);

/** Smallest body compressed when `http.compression` sets no threshold; the same default the response layer uses. */
const DEFAULT_THRESHOLD = 1024;

/** Content codings a stored entry may carry, base64 encoded. */
export type StoredEncodings = { gzip?: string; br?: string };

export type PageCacheEncodingChoice = "br" | "gzip";

/** What `http.compression` allows for stored entries, or `undefined` when compression is off. */
function storedCompressionPolicy(): { threshold: number; brotli: boolean } | undefined {
  const value = config.get("http.compression") as unknown;

  if (value === undefined || value === null || value === false) return undefined;
  if (value === true) return { threshold: DEFAULT_THRESHOLD, brotli: true };
  if (typeof value !== "object" || Array.isArray(value)) return undefined;

  const { threshold, brotli } = value as { threshold?: unknown; brotli?: unknown };

  return {
    threshold: typeof threshold === "number" && threshold >= 0 ? threshold : DEFAULT_THRESHOLD,
    brotli: brotli !== false,
  };
}

/** The weak entity tag of a body: the same text has the same tag in every coding. */
export function pageCacheEtag(body: string): string {
  return `W/"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
}

/**
 * The tag and, when `http.compression` is on and the body reaches its
 * threshold, the compressed forms of a body. Compressed once here, at store
 * time, so a HIT never compresses again.
 */
export async function encodeForStore(
  body: string,
): Promise<{ etag: string; encoded?: StoredEncodings }> {
  const etag = pageCacheEtag(body);
  const policy = storedCompressionPolicy();

  if (policy === undefined || Buffer.byteLength(body, "utf8") < policy.threshold) return { etag };

  const encoded: StoredEncodings = {
    gzip: (await gzip(body, { level: 9 })).toString("base64"),
  };

  if (policy.brotli) {
    encoded.br = (
      await brotliCompress(body, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(body, "utf8"),
        },
      })
    ).toString("base64");
  }

  return { etag, encoded };
}

/**
 * The stored coding an `Accept-Encoding` header asks for: the acceptable one
 * with the highest weight, `br` before `gzip` on a tie. `undefined` sends the
 * body as it is.
 */
export function pickStoredEncoding(
  header: unknown,
  encoded: StoredEncodings | undefined,
): PageCacheEncodingChoice | undefined {
  if (encoded === undefined) return undefined;

  const value = Array.isArray(header) ? header.join(",") : header;

  if (typeof value !== "string" || value.length === 0) return undefined;

  const weights = new Map<string, number>();

  for (const part of value.split(",")) {
    const [rawName, ...params] = part.split(";");
    const name = rawName?.trim().toLowerCase();

    if (!name) continue;

    let quality = 1;

    for (const param of params) {
      const [key, raw] = param.split("=");

      if (key?.trim().toLowerCase() === "q") {
        const parsed = Number(raw?.trim());
        quality = Number.isFinite(parsed) ? parsed : 0;
      }
    }

    weights.set(name, quality);
  }

  const any = weights.get("*");
  const weightOf = (name: string, alias?: string): number =>
    weights.get(name) ?? (alias ? weights.get(alias) : undefined) ?? any ?? 0;

  const candidates: [PageCacheEncodingChoice, number][] = [];

  if (encoded.br !== undefined) candidates.push(["br", weightOf("br")]);
  if (encoded.gzip !== undefined) candidates.push(["gzip", weightOf("gzip", "x-gzip")]);

  let chosen: PageCacheEncodingChoice | undefined;
  let best = 0;

  for (const [name, weight] of candidates) {
    if (weight > best) {
      chosen = name;
      best = weight;
    }
  }

  return chosen;
}

/** Whether an `If-None-Match` header names the entry's tag (weak comparison) or is `*`. */
export function ifNoneMatchSatisfied(header: unknown, etag: string): boolean {
  const value = Array.isArray(header) ? header.join(",") : header;

  if (typeof value !== "string" || value.length === 0) return false;
  if (value.trim() === "*") return true;

  const bare = (tag: string) => tag.trim().replace(/^W\//, "");

  return value.split(",").some((candidate) => bare(candidate) === bare(etag));
}
