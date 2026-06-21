import config from "@mongez/config";
import Fastify, { FastifyServerOptions } from "fastify";

export type FastifyInstance = ReturnType<typeof Fastify>;

/**
 * Default Fastify body limit. Kept at the historical 200GB so existing apps
 * don't regress on upgrade. Override via `http.bodyLimit` in config; for
 * per-route caps use the `maxBodySize()` middleware.
 */
const DEFAULT_BODY_LIMIT = 200 * 1024 * 1024 * 1024;

// Instantiate Fastify server
let server: FastifyInstance | undefined = undefined;

export function startHttpServer(options?: FastifyServerOptions): FastifyInstance {
  return (server = Fastify({
    trustProxy: true,
    bodyLimit: config.get("http.bodyLimit", DEFAULT_BODY_LIMIT),
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
