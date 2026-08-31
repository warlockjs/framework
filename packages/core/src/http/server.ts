import config from "@mongez/config";
import Fastify, { FastifyServerOptions } from "fastify";

export type FastifyInstance = ReturnType<typeof Fastify>;

// Instantiate Fastify server
let server: FastifyInstance | undefined = undefined;

export function startHttpServer(options?: FastifyServerOptions): FastifyInstance {
  // `config.set(key, undefined)` stores null rather than unsetting, so an app
  // that clears a key would otherwise hand Fastify `null` and crash the boot.
  const bodyLimit = config.get("http.bodyLimit") ?? undefined;

  return (server = Fastify({
    // `X-Forwarded-For` is client-settable and spoofable, and `request.ip` is
    // what @fastify/rate-limit keys its buckets on — so trusting it by default
    // makes rate limiting bypassable on any deployment NOT behind a proxy that
    // strips the header. Apps behind such a proxy opt in explicitly.
    //
    // The value is passed through untouched, so this resolves exactly as
    // Fastify does: `true`, a CIDR/IP list (string, comma-separated string or
    // array), or a predicate. `request.detectIp()` reads the client off
    // `request.ip`, so it walks the chain the same way.
    //
    // NOT a hop count: Fastify refuses numeric trustProxy outright and returns
    // no trust (`lib/request.js`, `getTrustProxyFn`) — a hop count cannot
    // validate the immediate peer, so a direct client could spoof
    // `X-Forwarded-*` by supplying enough hops. A number therefore fails closed
    // and SILENTLY does nothing; name your proxies with the list form instead.
    trustProxy: config.get("http.trustProxy", false),
    // No default: an app that configures nothing keeps Fastify's own 1MB limit
    // rather than the historical 200GB, which silently removed the protection
    // Fastify provides. Per-route caps go through `serverOptions.bodyLimit`;
    // the `maxBodySize()` middleware runs AFTER parsing and cannot reject
    // before the bytes are resident.
    ...(bodyLimit !== undefined && { bodyLimit }),
    // Close idle keep-alive connections on shutdown while letting in-flight
    // requests finish — the basis for graceful draining. Override via
    // `http.gracefulShutdown.forceCloseConnections`.
    forceCloseConnections: config.get("http.gracefulShutdown.forceCloseConnections", "idle"),
    ...options,
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
