import config from "@mongez/config";
import Fastify, { type FastifyServerOptions } from "fastify";
import type { Server as NodeHttpServer, ServerResponse } from "node:http";
import type {
  Http2Server,
  Http2SecureServer,
  Http2ServerResponse,
  ServerHttp2Session,
} from "node:http2";

type DrainServer = NodeHttpServer | Http2Server | Http2SecureServer;
type DrainResponse = ServerResponse | Http2ServerResponse;
import { normalizeRequestPath } from "../router/normalize-request-path";
import { registerErrorResponseFormatter } from "./error-response";
import type { HttpServerOptions } from "./types";

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

export function startHttpServer(options?: HttpServerOptions): FastifyInstance {
  // `config.set(key, undefined)` stores null rather than unsetting, so an app
  // that clears a key is treated the same as an app that never configured it.
  const trustProxy = resolveTrustProxy(config.get("http.trustProxy", false));

  const bodyLimit = config.get("http.bodyLimit") ?? undefined;
  const configuredRewriteUrl = options?.rewriteUrl;
  const http2 = options?.http2 === true;
  const requestedForceClose =
    options?.forceCloseConnections ??
    config.get("http.gracefulShutdown.forceCloseConnections", http2 ? false : "idle");
  // HTTP/2 has sessions rather than closeIdleConnections(); session tracking
  // below supplies graceful draining even when Fastify cannot use idle mode.
  const forceCloseConnections =
    http2 && requestedForceClose === "idle" ? false : requestedForceClose;

  // Keep the framework's established HTTP-compatible reply facade while
  // accepting Fastify's HTTP/1 and HTTP/2 option overloads at this boundary.
  const createServer = Fastify as (options: HttpServerOptions) => FastifyInstance;
  server = createServer({
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
    ...options,
    forceCloseConnections,
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
  });

  registerErrorResponseFormatter(server);

  // `"idle"` promises that idle keep-alive connections close on shutdown. Fastify
  // only reaps the ones idle at the moment close starts; a connection whose
  // request finishes DURING the drain stays open and holds `close()` until
  // the shutdown budget expires. Track responses so the drain can
  // retire those connections as they go idle.
  if (http2 || forceCloseConnections === "idle") {
    trackConnectionsForDrain(server.server as DrainServer);
  }

  return server;
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
export type ClosableServer = {
  close: () => Promise<unknown>;
  /** The underlying Node server, when there is one (a Fastify instance's `.server`). */
  server?: unknown;
};

/**
 * Per-server drain state: the responses currently in flight, and whether a
 * graceful shutdown has begun.
 */
type DrainState = {
  inFlight: Set<DrainResponse>;
  sessions: Set<ServerHttp2Session>;
  draining: boolean;
};

const drainStates = new WeakMap<object, DrainState>();

/**
 * Mark a response so its connection closes once it is sent. Only possible
 * before the headers go out; a response that already streams its headers is
 * retired by {@link reapIdleConnections} after it finishes instead.
 */
function retireAfterResponse(response: DrainResponse): void {
  // HTTP/2 drains the session with GOAWAY; connection headers are forbidden.
  if ("stream" in response) return;
  if (response.headersSent || response.writableEnded) return;

  response.setHeader("Connection", "close");
}

function reapIdleConnections(rawServer: DrainServer): void {
  if ("closeIdleConnections" in rawServer && typeof rawServer.closeIdleConnections === "function") {
    rawServer.closeIdleConnections();
  }
}

/**
 * Track in-flight responses on a Node HTTP server so a graceful drain can
 * close keep-alive connections that become idle AFTER `close()` started.
 *
 * Node's `server.close()` (and Fastify's `forceCloseConnections: "idle"`)
 * closes only the connections idle at that moment. A request in flight when
 * shutdown begins finishes its response, the client keeps the connection
 * alive, and `close()` waits on it until the shutdown budget runs out. Active
 * responses are never cut short: each one is told to close its connection
 * when it is done (`Connection: close`), and every connection is reaped as
 * soon as its response has finished.
 */
export function trackConnectionsForDrain(rawServer: DrainServer): void {
  if (!rawServer || typeof rawServer.on !== "function" || drainStates.has(rawServer)) return;

  const state: DrainState = { inFlight: new Set(), sessions: new Set(), draining: false };

  drainStates.set(rawServer, state);

  rawServer.on("session", (session: ServerHttp2Session) => {
    state.sessions.add(session);
    session.once("close", () => state.sessions.delete(session));
    if (state.draining) session.close();
  });

  rawServer.on("request", (_request: unknown, response: DrainResponse) => {
    state.inFlight.add(response);

    if (state.draining) retireAfterResponse(response);

    response.once("close", () => {
      state.inFlight.delete(response);

      // The socket becomes idle once Node finishes handling this response,
      // which happens after the response's own `close` event.
      if (state.draining) setImmediate(() => reapIdleConnections(rawServer));
    });
  });
}

/**
 * Begin a graceful drain on a server tracked by {@link trackConnectionsForDrain}:
 * every in-flight response closes its connection when it is done, and idle
 * keep-alive connections are closed now and whenever another one goes idle.
 * A server that is not tracked is left alone.
 *
 * @returns Whether the server was tracked (and is now draining).
 */
export function beginHttpDrain(rawServer: unknown): boolean {
  if (!rawServer || typeof rawServer !== "object") return false;

  const state = drainStates.get(rawServer);

  if (!state) return false;

  state.draining = true;

  for (const response of state.inFlight) {
    retireAfterResponse(response);
  }

  // close() sends GOAWAY and waits for active streams before closing the socket.
  for (const session of state.sessions) session.close();

  reapIdleConnections(rawServer as DrainServer);

  return true;
}

/**
 * Close a server, bounded by a timeout. Fastify's `close()` stops accepting new
 * requests (it answers 503 while closing) and drains the in-flight ones; this
 * wraps it so a single stuck request can't hang shutdown forever. When the
 * server's connections are tracked (the default `"idle"` mode), keep-alive
 * connections that go idle during the drain are closed too, so a finished
 * request does not hold the shutdown open.
 *
 * @returns `true` if the server drained cleanly, `false` if the timeout fired first.
 */
export async function closeServerWithTimeout(
  server: ClosableServer,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  beginHttpDrain(server.server);

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
