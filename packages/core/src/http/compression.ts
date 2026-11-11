/**
 * Response compression (`http.compression`), built on `node:zlib`.
 *
 * Two entry points share one set of rules:
 *
 * - an `onSend` hook on the root server compresses every body that goes
 *   through Fastify's reply: strings and buffers (JSON, `response.html()`,
 *   page data, cached page bodies) and Node readable streams
 *   (`response.sendFile()`, generated files);
 * - `Response.streamReact()` asks {@link prepareStreamCompression} before it
 *   writes its headers, and pipes the React stream through a compressor that
 *   flushes after every burst of writes, so the shell and each deferred chunk
 *   still reach the browser as soon as they are rendered.
 *
 * Skipped: HEAD requests, 1xx/204/206/304 answers, responses that already
 * carry a `Content-Encoding` or a `Content-Range`, `Cache-Control:
 * no-transform`, bodies smaller than `threshold`, content types that do not
 * compress (images, archives, video), and long-lived streams that must flush
 * promptly (`text/event-stream`, NDJSON, `response.stream()`, `response.sse()`).
 *
 * @internal
 */
import config from "@mongez/config";
import type { FastifyReply, FastifyRequest } from "fastify";
import { pipeline, Writable } from "node:stream";
import { promisify } from "node:util";
import zlib from "node:zlib";
import type { HttpCompressionConfig } from "./types";
import type { FastifyInstance } from "./server";

/** Content codings the framework produces. */
export type CompressionEncoding = "br" | "gzip";

/** `http.compression` after defaults are applied. */
export type ResolvedCompression = {
  /** Smallest body, in bytes, that is compressed. */
  threshold: number;
  /** Whether `br` is offered (otherwise only `gzip`). */
  brotli: boolean;
};

/** Bodies below this many bytes are sent as they are by default. */
export const DEFAULT_COMPRESSION_THRESHOLD = 1024;

/**
 * Brotli quality for responses compressed on the fly: 4 keeps the CPU cost
 * near gzip's while still producing smaller output. The maximum (11) is meant
 * for assets compressed once at build time.
 */
const BROTLI_QUALITY = 4;

const brotliCompress = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/** Where the resolved settings live on the root server (children inherit it). */
const COMPRESSION_SETTINGS = Symbol.for("warlock.http.compression");

/**
 * Normalise the `http.compression` value. `false`/unset turns compression
 * off (`undefined`); `true` or an object turns it on with defaults filled in.
 *
 * @throws TypeError on a value of the wrong shape, naming the option to fix.
 */
export function resolveCompressionConfig(value: unknown): ResolvedCompression | undefined {
  if (value === undefined || value === null || value === false) return undefined;

  if (value === true) {
    return { threshold: DEFAULT_COMPRESSION_THRESHOLD, brotli: true };
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const { threshold, brotli } = value as Exclude<HttpCompressionConfig, boolean>;

    if (
      threshold !== undefined &&
      (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0)
    ) {
      throw new TypeError(
        "Invalid http.compression.threshold: expected a number of bytes (0 or more). " +
          `Received ${String(threshold)}.`,
      );
    }

    if (brotli !== undefined && typeof brotli !== "boolean") {
      throw new TypeError(
        `Invalid http.compression.brotli: expected true or false. Received ${typeof brotli}.`,
      );
    }

    return {
      threshold: threshold ?? DEFAULT_COMPRESSION_THRESHOLD,
      brotli: brotli ?? true,
    };
  }

  throw new TypeError(
    "Invalid http.compression configuration: expected true, false, or " +
      `{ threshold?: number; brotli?: boolean }. Received ${typeof value}.`,
  );
}

/**
 * Pick the coding for an `Accept-Encoding` header: the acceptable coding with
 * the highest q-value, `br` before `gzip` on a tie. `*` stands for any coding
 * not listed. `undefined` means send the body as it is.
 */
export function negotiateEncoding(
  header: unknown,
  brotli: boolean,
): CompressionEncoding | undefined {
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

  const candidates: [CompressionEncoding, number][] = [];

  if (brotli) candidates.push(["br", weightOf("br")]);

  candidates.push(["gzip", weightOf("gzip", "x-gzip")]);

  let chosen: CompressionEncoding | undefined;
  let best = 0;

  for (const [name, weight] of candidates) {
    if (weight > best) {
      chosen = name;
      best = weight;
    }
  }

  return chosen;
}

const COMPRESSIBLE_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/x-javascript",
  "application/ecmascript",
  "application/xml",
  "application/wasm",
  "application/vnd.ms-fontobject",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/bmp",
  "font/ttf",
  "font/otf",
]);

/**
 * Types that are written as a live stream of lines or events: compressing
 * them would hold each line back until the compressor fills a block.
 */
const STREAMING_TYPES = new Set(["text/event-stream", "application/x-ndjson"]);

/** Whether a `Content-Type` value names a text-like body worth compressing. */
export function isCompressibleType(contentType: unknown): boolean {
  if (typeof contentType !== "string") return false;

  const separator = contentType.indexOf(";");
  const type = (separator === -1 ? contentType : contentType.slice(0, separator))
    .trim()
    .toLowerCase();

  if (STREAMING_TYPES.has(type)) return false;

  if (type.startsWith("text/")) return true;

  if (COMPRESSIBLE_TYPES.has(type)) return true;

  return type.endsWith("+json") || type.endsWith("+xml");
}

/** The header access both a Fastify reply and a core `Response` offer. */
type HeaderTarget = {
  getHeader(name: string): unknown;
  header(name: string, value: unknown): unknown;
  removeHeader(name: string): unknown;
};

function headerText(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");

  return value === undefined || value === null ? "" : String(value);
}

/**
 * Add `Accept-Encoding` to the response's single `Vary` header, keeping what
 * is already there. `Vary: *` already covers it.
 */
export function mergeVaryAcceptEncoding(target: HeaderTarget): void {
  const current = headerText(target.getHeader("vary")).trim();

  if (current === "") {
    target.header("Vary", "Accept-Encoding");
    return;
  }

  const tokens = current.split(",").map((token) => token.trim().toLowerCase());

  if (tokens.includes("*") || tokens.includes("accept-encoding")) return;

  target.header("Vary", `${current}, Accept-Encoding`);
}

/**
 * Whether the response's status and headers allow it to be re-encoded at
 * all. The body size and the client's `Accept-Encoding` are checked after.
 */
export function canCompressResponse(
  method: string | undefined,
  statusCode: number,
  target: Pick<HeaderTarget, "getHeader">,
): boolean {
  if (method?.toUpperCase() === "HEAD") return false;

  if (statusCode < 200 || statusCode === 204 || statusCode === 206 || statusCode === 304) {
    return false;
  }

  if (headerText(target.getHeader("content-encoding")) !== "") return false;

  if (headerText(target.getHeader("content-range")) !== "") return false;

  if (/(?:^|,)\s*no-transform\s*(?:,|$)/i.test(headerText(target.getHeader("cache-control")))) {
    return false;
  }

  return isCompressibleType(target.getHeader("content-type"));
}

/**
 * Mark the response as re-encoded: `Content-Encoding`, `Vary`, no
 * `Content-Length` (the encoded size differs), and a strong `ETag` turned
 * weak, because the encoded bytes are no longer the ones it names.
 * Conditional requests keep working: `If-None-Match` compares weakly.
 */
function applyEncodingHeaders(target: HeaderTarget, encoding: CompressionEncoding): void {
  target.header("Content-Encoding", encoding);
  target.removeHeader("content-length");

  const etag = target.getHeader("etag");

  if (typeof etag === "string" && etag.length > 0 && !etag.startsWith("W/")) {
    target.header("ETag", `W/${etag}`);
  }
}

/** A zlib stream for `encoding`, tuned for responses compressed on the fly. */
export function createCompressionStream(encoding: CompressionEncoding, sizeHint?: number) {
  if (encoding === "br") {
    return zlib.createBrotliCompress({
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        ...(sizeHint !== undefined && { [zlib.constants.BROTLI_PARAM_SIZE_HINT]: sizeHint }),
      },
    });
  }

  return zlib.createGzip();
}

/** Compress a whole body off the main thread (zlib runs on the libuv pool). */
export function compressBuffer(body: Buffer, encoding: CompressionEncoding): Promise<Buffer> {
  if (encoding === "br") {
    return brotliCompress(body, {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
      },
    });
  }

  return gzip(body);
}

function isNodeReadable(payload: unknown): payload is NodeJS.ReadableStream {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { pipe?: unknown }).pipe === "function" &&
    typeof (payload as { on?: unknown }).on === "function"
  );
}

function toBuffer(payload: unknown): Buffer | undefined {
  if (typeof payload === "string") return Buffer.from(payload);

  if (Buffer.isBuffer(payload)) return payload;

  if (ArrayBuffer.isView(payload)) {
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  }

  return undefined;
}

/**
 * The `onSend` step: re-encode `payload` when the response and the client
 * allow it, otherwise return it untouched.
 */
export async function compressPayload(
  request: Pick<FastifyRequest, "method" | "headers">,
  reply: HeaderTarget & { statusCode: number },
  payload: unknown,
  settings: ResolvedCompression,
): Promise<unknown> {
  if (payload === undefined || payload === null) return payload;

  if (!canCompressResponse(request.method, reply.statusCode, reply)) return payload;

  const body = toBuffer(payload);

  if (body !== undefined) {
    if (body.length < settings.threshold) return payload;

    mergeVaryAcceptEncoding(reply);

    const encoding = negotiateEncoding(request.headers["accept-encoding"], settings.brotli);

    if (encoding === undefined) return payload;

    const compressed = await compressBuffer(body, encoding);

    // Already-dense data can grow; the original is the better answer then.
    if (compressed.length >= body.length) return payload;

    applyEncodingHeaders(reply, encoding);

    return compressed;
  }

  if (!isNodeReadable(payload)) return payload;

  const declaredLength = Number(headerText(reply.getHeader("content-length")));

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > 0 &&
    declaredLength < settings.threshold
  ) {
    return payload;
  }

  mergeVaryAcceptEncoding(reply);

  const encoding = negotiateEncoding(request.headers["accept-encoding"], settings.brotli);

  if (encoding === undefined) return payload;

  applyEncodingHeaders(reply, encoding);

  const compressor = createCompressionStream(
    encoding,
    Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : undefined,
  );

  // The source's errors reach the compressor, which Fastify watches like any
  // stream payload; a client that goes away destroys both.
  pipeline(payload, compressor, () => {});

  return compressor;
}

/**
 * Register response compression on the root server when `http.compression`
 * is on. Called once by `startHttpServer`, after the JSON error formatter so
 * the formatted body is the one compressed. Nothing is registered (and no
 * request pays anything) when it is off.
 *
 * @internal
 */
export function registerResponseCompression(server: FastifyInstance): void {
  const settings = resolveCompressionConfig(config.get("http.compression"));

  if (settings === undefined) return;

  server.decorate(COMPRESSION_SETTINGS, settings);

  server.addHook("onSend", (request: FastifyRequest, reply: FastifyReply, payload: unknown) =>
    compressPayload(request, reply, payload, settings),
  );
}

/** The active compression settings for the server that owns `reply`. */
export function compressionSettingsFor(reply: FastifyReply): ResolvedCompression | undefined {
  const owner = reply.server as unknown as Record<symbol, ResolvedCompression | undefined>;

  return owner?.[COMPRESSION_SETTINGS];
}

/**
 * Decide the coding for a response written straight to the socket
 * (`Response.streamReact()`), and set its headers. Call before the headers
 * are written. Returns `undefined` when the stream goes out as it is.
 */
export function prepareStreamCompression(
  reply: FastifyReply,
  target: HeaderTarget,
  statusCode: number,
): CompressionEncoding | undefined {
  const settings = compressionSettingsFor(reply);

  if (settings === undefined) return undefined;

  if (!canCompressResponse(reply.request?.method, statusCode, target)) return undefined;

  mergeVaryAcceptEncoding(target);

  const encoding = negotiateEncoding(reply.request?.headers?.["accept-encoding"], settings.brotli);

  if (encoding === undefined) return undefined;

  applyEncodingHeaders(target, encoding);

  return encoding;
}

/**
 * A writable that compresses into `raw` and flushes after each burst of
 * writes (one flush per event-loop turn, and whenever the writer calls
 * `flush()`), so a progressively rendered page still arrives progressively.
 * Ending it ends `raw`; `raw` closing early (the client left) tears it down.
 */
export function createFlushingCompressor(
  raw: NodeJS.WritableStream & { once(event: "close", listener: () => void): unknown },
  encoding: CompressionEncoding,
): Writable & { flush(): void } {
  const compressor = createCompressionStream(encoding);
  let flushScheduled = false;

  const flushSoon = (): void => {
    if (flushScheduled) return;

    flushScheduled = true;

    setImmediate(() => {
      flushScheduled = false;

      if (!compressor.destroyed && !compressor.writableEnded) compressor.flush();
    });
  };

  compressor.on("error", (error) => {
    const destroyable = raw as { destroy?: (error?: Error) => void };

    destroyable.destroy?.(error);
  });

  compressor.pipe(raw);

  const destination = new Writable({
    write(chunk, encodingName, callback) {
      if (compressor.destroyed || compressor.writableEnded) {
        callback();
        return;
      }

      const ready = compressor.write(chunk, encodingName);

      flushSoon();

      if (ready) callback();
      else compressor.once("drain", () => callback());
    },
    final(callback) {
      if (!compressor.destroyed && !compressor.writableEnded) compressor.end();

      callback();
    },
    // Runs after a normal finish too (auto-destroy): only a failure may tear
    // the compressor down, or its last block would never reach `raw`.
    destroy(error, callback) {
      if (error && !compressor.destroyed) compressor.destroy(error);

      callback(error);
    },
  }) as Writable & { flush(): void };

  destination.flush = flushSoon;

  raw.once("close", () => {
    if (!compressor.destroyed) compressor.destroy();
  });

  return destination;
}
