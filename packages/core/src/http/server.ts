import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import Fastify, { type FastifyServerOptions } from "fastify";

export type FastifyInstance = ReturnType<typeof Fastify>;

// Instantiate Fastify server
let server: FastifyInstance | undefined = undefined;

/**
 * Warn when `http.trustProxy` is a number.
 *
 * Fastify refuses hop-count trust outright and returns no trust at all
 * (`lib/request.js`, `getTrustProxyFn`) — a hop count cannot validate the
 * immediate peer, so honouring one would let a direct client spoof
 * `X-Forwarded-*` by supplying enough hops.
 *
 * Failing closed is the right call, but it is SILENT, and silence is the whole
 * defect: a number reads like bounded trust and delivers none. Behind a real
 * proxy every client then resolves to the PROXY's address, which collapses
 * ip-filter allowlists, rate-limit buckets and idempotency scoping onto a
 * single key. That is a correctness and availability failure, not a security
 * one — but nothing tells the operator it is happening.
 *
 * Boot is the only honest place to say so: the value is inert from the first
 * request onward, so there is no later moment where the mistake surfaces.
 */
function warnOnInertTrustProxy(trustProxy: unknown): void {
  if (typeof trustProxy !== "number") return;

  log.warn(
    "http",
    "config",
    `http.trustProxy is set to the number ${trustProxy}, which grants NO proxy trust — ` +
      `Fastify refuses hop-count trust because a hop count cannot validate the immediate peer. ` +
      `request.ip will stay the socket peer, so behind a proxy every client resolves to the ` +
      `proxy's address and ip-filter allowlists, rate-limit buckets and idempotency scoping ` +
      `collapse onto one key. Name your proxies instead — http.trustProxy: "10.0.0.0/8" (an IP, ` +
      `CIDR block, or list of them), or true if nothing but your edge can reach this process.`,
  );
}
export function startHttpServer(options?: FastifyServerOptions): FastifyInstance {
  // `config.set(key, undefined)` stores null rather than unsetting, so an app
  // that clears a key would otherwise hand Fastify `null` and crash the boot.
  const trustProxy: unknown = config.get("http.trustProxy", false);

  warnOnInertTrustProxy(trustProxy);

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
