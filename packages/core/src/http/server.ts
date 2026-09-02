import config from "@mongez/config";
import Fastify, { type FastifyServerOptions } from "fastify";
import { normalizeRequestPath } from "../router/normalize-request-path";

export type FastifyInstance = ReturnType<typeof Fastify>;

// Instantiate Fastify server
let server: FastifyInstance | undefined = undefined;

/** Fastify's accepted, non-null `trustProxy` configuration shape. */
type TrustProxy = NonNullable<FastifyServerOptions["trustProxy"]>;
type TrustProxyPredicate = (address: string, hop: number) => boolean;

function isTrustProxyPredicate(value: unknown): value is TrustProxyPredicate {
  return typeof value === "function";
}

function isTrustProxyList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  );
}

function resolveTrustProxy(value: unknown): TrustProxy {
  if (value === undefined || value === null) return false;

  if (typeof value === "boolean" || isTrustProxyPredicate(value)) return value;

  if (typeof value === "string" && value.trim().length > 0) return value;

  if (isTrustProxyList(value)) return value;

  const received = Array.isArray(value) ? "array" : typeof value;

  throw new TypeError(
    "Invalid http.trustProxy configuration: expected a boolean, a non-empty IP/CIDR string, " +
      `a non-empty string array, or a predicate function; received ${received}.`,
  );
}

function normalizeRequestUrl(url: string): string {
  const queryIndex = url.indexOf("?");

  if (queryIndex === -1) return normalizeRequestPath(url);

  return normalizeRequestPath(url.slice(0, queryIndex)) + url.slice(queryIndex);
}

export function startHttpServer(
  options?: FastifyServerOptions,
): FastifyInstance {
  // `config.set(key, undefined)` stores null rather than unsetting, so an app
  // that clears a key is treated the same as an app that never configured it.
  const trustProxy = resolveTrustProxy(config.get("http.trustProxy", false));

  const bodyLimit = config.get("http.bodyLimit") ?? undefined;
  const configuredRewriteUrl = options?.rewriteUrl;

  return (server = Fastify({
    // `X-Forwarded-For` is client-settable and spoofable, and `request.ip` is
    // what @fastify/rate-limit keys its buckets on — so trusting it by default
    // makes rate limiting bypassable on any deployment NOT behind a proxy that
    // strips the header. Apps behind such a proxy opt in explicitly.
    //
    // Validated shapes resolve exactly as Fastify does: `true`, a CIDR/IP list
    // (string, comma-separated string or array), or a predicate.
    trustProxy,
    // No default: an app that configures nothing keeps Fastify's own 1MB limit
    // rather than the historical 200GB, which silently removed the protection
    // Fastify provides. Per-route caps go through `serverOptions.bodyLimit`;
    // the `maxBodySize()` middleware runs AFTER parsing and cannot reject
    // before the bytes are resident.
    ...(bodyLimit !== undefined && { bodyLimit }),
    // Close idle keep-alive connections on shutdown while letting in-flight
    // requests finish — the basis for graceful draining. Override via
    // `http.gracefulShutdown.forceCloseConnections`.
    forceCloseConnections: config.get(
      "http.gracefulShutdown.forceCloseConnections",
      "idle",
    ),
    ...options,
    // Fastify calls this before route matching in both production `scan()` and
    // the development wildcard dispatcher. Compose an app-supplied rewrite
    // first, then apply the one framework request-path normalizer so the two
    // modes cannot disagree about a terminal slash.
    rewriteUrl(request) {
      const rewritten = configuredRewriteUrl
        ? configuredRewriteUrl.call(this, request)
        : (request.url ?? "/");

      return normalizeRequestUrl(rewritten);
    },
  }));
}

/**
 * Expose the server to be publicly accessible
 */
export function getHttpServer(): FastifyInstance {
  return server;
}

/**
 * Minimal shape needed to close a server — lets {@link closeServerWithTimeout}
 * be unit-tested with a fake instead of a real Fastify instance.
 */
export type ClosableServer = { close: () => Promise<unknown> };

/**
 * Close a server, bounded by a timeout. Fastify's `close()` stops accepting new
 * requests (it answers 503 while closing) and drains the in-flight ones; this
 * wraps it so a single stuck request can't hang shutdown forever.
 *
 * @returns `true` if the server drained cleanly, `false` if the timeout fired first.
 */
export async function closeServerWithTimeout(
  server: ClosableServer,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const drained = server.close().then(() => true);

  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });

  try {
    return await Promise.race([drained, timedOut]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
