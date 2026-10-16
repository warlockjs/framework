import type { CookieSerializeOptions } from "@fastify/cookie";
import type { FastifyCorsOptions } from "@fastify/cors";
import type { FastifyHttpOptions } from "fastify";
import type { Server as NodeHttpServer } from "node:http";
import type React from "react";
import type { Middleware } from "../router";
import type { HttpRateLimitConfig } from "./build-rate-limit-options";
import type { StreamQueueOptions } from "./bounded-stream-queue";
import type { CspConfig } from "./csp";
import type { HttpErrorMapper } from "./error-mapper";
import type { HttpLoggingConfig } from "./request-log-snapshot";
import type { Response } from "./response";
import type { HttpTracingConfig } from "./tracing/tracing.type";

export type RequestEvent =
  "executingMiddleware" | "executedMiddleware" | "executingAction" | "executedAction";

/**
 * Private, server-only, per-request data bag — `request.locals`.
 *
 * An `interface`, not a `type`, because it is a declaration-merging target
 * (the project's `type`-by-default rule's one legitimate exception): apps
 * and packages augment it via `declare module`, and only an `interface` can
 * be reopened that way.
 *
 * `authDerived` is core's own first occupant, set by the `user` and
 * `decodedAccessToken` accessors below — see `request.ts` for what it means
 * and why it is set-once. Augment further via module augmentation, in the
 * module that OWNS the key (not centrally), the same mechanism `RequestUser`
 * and the web layer's `SharedContext` use:
 *
 * @example
 * ```typescript
 * declare module "@warlock.js/core" {
 *   interface RequestLocals {
 *     session?: { token: string };
 *   }
 * }
 * ```
 */
export interface RequestLocals {
  /**
   * Whether this request has, at any point, been assigned a
   * `decodedAccessToken` — set by its accessor in `request.ts`, never by
   * anything else, and never cleared once set. Absent (not `false`) on a
   * request that never touched auth state; a later stage reads this to
   * decide cache headers, but that stage is not this one.
   *
   * `@warlock.js/auth` writes the authenticated user to `locals.user` (a key
   * it augments onto this interface — see `RequestUser` in that package) but
   * does not set `authDerived` when doing so; only `decodedAccessToken`
   * marks this flag. Core intentionally does not restore a user-triggered
   * cache mark here (see the 5.12.0 CHANGELOG for the design ruling).
   */
  authDerived?: boolean;
}

/**
 * Decoded access-token claims attached to the current request —
 * `request.decodedAccessToken`.
 *
 * `userType` is the one claim core itself reads (the idempotency key builder,
 * `core/src/http/middleware/utils/idempotency-key.ts`); the auth package's
 * own middleware decodes and assigns the full JWT payload, which carries
 * more (`id`, `created_at`, `tokenType`, `iat`, `exp`) than core needs to
 * know the shape of. Declared as a `type`, not a declaration-merging
 * `interface`, because nothing in core augments it — auth's own richer
 * shape is simply assignable here.
 */
export type DecodedAccessToken = {
  userType?: string;
};

/**
 * Allowed response type
 */
export type ReturnedResponse =
  /**
   * Can be a response object
   */
  | Response
  /**
   * Or a promise returning a response object
   */
  | Promise<Response>
  /**
   * Or an object
   */
  | Record<string, any>
  /**
   * Or a promise returning an object
   */
  | Promise<Record<string, any>>
  /**
   * Or an array
   */
  | any[]
  /**
   * Or a promise returning an array
   */
  | Promise<any[]>;

/**
 * Response Event Types
 */
export type ResponseEvent =
  /**
   * Triggered before sending the response
   */
  | "sending"
  /**
   * Triggered before sending json response
   */
  | "sendingJson"
  /**
   * Triggered after sending success json response
   */
  | "sendingSuccessJson"
  /**
   * Triggered after sending bad request json response
   */
  | "sendingBadRequestJson"
  /**
   * Triggered after sending the response regardless of the response status code
   */
  | "sent"
  /**
   * Triggered after sending the response if the response status code is 2xx
   */
  | "success"
  /**
   * Triggered after sending the response if the response status code is 201
   */
  | "successCreate"
  /**
   * Triggered after sending the response if the response status code is 400
   */
  | "badRequest"
  /**
   * Triggered after sending the response if the response status code is 401
   */
  | "unauthorized"
  /**
   * Triggered after sending the response if the response status code is 403
   */
  | "forbidden"
  /**
   * Triggered after sending the response if the response status code is 404
   */
  | "notFound"
  /**
   * Triggered after sending the response if the response status code is 413
   */
  | "contentTooLarge"
  /**
   * Triggered after sending the response if the response status code is 429
   */
  | "throttled"
  /**
   * Triggered after sending the response if the response status code is 500
   */
  | "serverError"
  /**
   * Triggered after sending the response if the response status code is 4xx or 5xx
   */
  | "error";

/**
 * Partial Middleware
 */
export interface PartialMiddleware {
  /**
   * Routes list
   * @example routes: ["/users", "/posts"]
   */
  routes?: string[];
  /**
   * Named routes list
   *
   * @example namedRoutes: ["users.list", "posts.list"]
   */
  namedRoutes?: string[];
  /**
   * Middlewares list
   */
  middleware: Middleware[];
}

/**
 * Options for the underlying Fastify server, passed through by
 * `http.serverOptions`. Includes `http`, the options Node's
 * `http.createServer()` receives (for example `maxHeaderSize`).
 *
 * Framework-owned settings (`trustProxy`, `bodyLimit`,
 * `gracefulShutdown.forceCloseConnections`) have their own `http.*` keys;
 * setting them here as well overrides those keys.
 */
export type HttpServerOptions = FastifyHttpOptions<NodeHttpServer>;

/**
 * Http Configurations list
 */
export interface HttpConfigurations {
  /**
   * Options for the underlying Fastify server, applied when it is created.
   *
   * Node's own HTTP server options go under `http`. The request header size
   * limit, for example, is `serverOptions.http.maxHeaderSize` (Node's default
   * is 16KB); a top-level `maxHeaderSize` is not a Fastify option and is
   * ignored.
   *
   * @example
   * ```ts
   * const httpConfigurations: HttpConfigurations = {
   *   serverOptions: {
   *     http: { maxHeaderSize: 32 * 1024 },
   *     keepAliveTimeout: 10_000,
   *   },
   * };
   * ```
   */
  serverOptions?: HttpServerOptions;
  /**
   * Status used when a Cascade model fails validation during a database write.
   * The default is 500 because request input has already been validated before
   * a model write begins; set this only when an application deliberately needs
   * a different response status.
   *
   * @default 500
   */
  modelValidationErrorStatus?: number;
  /**
   * Map errors that are not an `HttpError` to an HTTP status (and optional
   * message/payload), so domain errors shared with non-HTTP processes need not
   * extend Core's error classes. Return `undefined` to keep the default
   * handling. See {@link HttpErrorMapper}.
   */
  errorMapper?: HttpErrorMapper;
  /**
   * Server port
   */
  port?: number;
  /**
   * Log requests
   */
  log?: boolean;
  /**
   * What request log entries carry of each request's input. Entries carry a
   * bounded `RequestLogSnapshot`, never the `Request`/`Response`
   * instances; credential-bearing query values are masked in its URL.
   * A route's own `logging` option overrides these defaults.
   */
  logging?: HttpLoggingConfig;
  /**
   * Cors configurations
   */
  cors?: FastifyCorsOptions;
  /**
   * File upload limit in bytes
   *
   * @default 10MB
   */
  fileUploadLimit?: number;
  /**
   * Multipart limits, hitting any of them answers 413.
   * Every uploaded file is buffered in memory, keep these small.
   */
  multipart?: {
    /**
     * Max number of files per request
     *
     * @default 10
     */
    files?: number;
    /**
     * Max number of non-file fields per request
     *
     * @default 100
     */
    fields?: number;
    /**
     * Max size in bytes of a single non-file field value
     *
     * @default 1MB
     */
    fieldSize?: number;
  };
  /**
   * Global Fastify body size limit in bytes.
   *
   * Applies to every request body (JSON, form-urlencoded, raw). For per-route
   * limits use the `maxBodySize()` middleware. For multipart uploads use
   * `fileUploadLimit` (capped by `@fastify/multipart`).
   *
   * @default 200 * 1024 * 1024 * 1024  // 200GB — historical default; consider lowering for production.
   */
  bodyLimit?: number;
  /**
   * Which upstream hops may be trusted to report the real client address via
   * `X-Forwarded-For`. Passed straight to Fastify, so every shape Fastify
   * supports works here, and `request.ip` / `request.detectIp()` resolve the
   * client identically:
   *
   * - `false` (default) — trust nothing; the socket peer address is the client.
   * - `true` — trust the whole chain; the leftmost `X-Forwarded-For` entry wins.
   * - `string` / `string[]` — trust only these proxy addresses: exact IPs,
   *   CIDR blocks (`"10.0.0.0/8"`), the named ranges `"loopback"`,
   *   `"linklocal"`, `"uniquelocal"`, or a comma-separated string of those.
   * - `(address, hop) => boolean` — custom predicate.
   *
   * Anything but `false` is a trust boundary: every hop you trust can forge the
   * addresses to its left. Prefer the narrowest shape your topology allows —
   * `true` is only safe when nothing but your edge can reach the process.
   *
   * @default false
   */
  trustProxy?: boolean | string | string[] | ((address: string, hop: number) => boolean);
  cookies?: {
    /**
     * Secret key for signed cookies
     */
    secret?: string;
    /**
     * Default cookie options
     */
    options?: CookieSerializeOptions;
  };
  /**
   * Opt-in `Content-Security-Policy` header, built per-request from a
   * documented default policy merged with these directives, plus the
   * framework's own per-request CSP nonce on `script-src`.
   *
   * Disabled by default — no header, no behaviour change — until `enabled`
   * is set `true`. See `csp.ts` for the default policy and merge rules, and
   * the `configure-app` / `send-response` skills for usage.
   */
  csp?: CspConfig;
  /**
   * Rate limit
   */
  rateLimit?: HttpRateLimitConfig;
  /**
   * Request id (correlation) settings.
   *
   * The framework generates a `request.id` for every incoming request and
   * echoes it back as a response header so clients, logs, and traces can
   * correlate by a single value. Set `enabled: false` to disable echo + inherit.
   */
  requestId?: {
    /**
     * Inbound + outbound header name.
     *
     * @default "X-Request-Id"
     */
    header?: string;
    /**
     * Generator override. Defaults to a 32-char random string.
     */
    generator?: () => string;
    /**
     * Set to false to disable echo + inherit. The framework still generates
     * `request.id` for internal logging.
     *
     * @default true
     */
    enabled?: boolean;
  };
  /**
   * Idempotency middleware defaults. Per-call options on `idempotency()` win.
   */
  idempotency?: {
    /**
     * Cache TTL in seconds.
     *
     * @default 86400 — 24h, matches Stripe's window.
     */
    ttl?: number;
    /**
     * Header name carrying the client's idempotency key.
     *
     * @default "Idempotency-Key"
     */
    headerName?: string;
    /**
     * HTTP methods eligible for idempotency. Safe methods (GET/HEAD) are
     * always skipped regardless of this setting.
     *
     * @default ["POST", "PUT", "PATCH", "DELETE"]
     */
    methods?: string[];
    /**
     * Cache driver name. Defaults to the manager's default driver.
     */
    driver?: string;
  };
  /**
   * Maintenance mode configuration. The `maintenance()` middleware reads these.
   */
  maintenance?: {
    /**
     * Toggle maintenance mode. When true, every request returns 503 unless
     * its path matches the `allowlist`.
     *
     * @default false
     */
    enabled?: boolean;
    /**
     * Path prefixes (ending in `*`) or exact paths to bypass.
     *
     * @default ["/health"]
     */
    allowlist?: string[];
    /**
     * Seconds advertised in the `Retry-After` response header.
     *
     * @default 60
     */
    retryAfter?: number;
  };
  /**
   * Graceful shutdown behaviour for the HTTP server.
   */
  gracefulShutdown?: {
    /**
     * Milliseconds to wait for in-flight requests to drain on shutdown before
     * the server is force-closed.
     *
     * @default 10000
     */
    timeout?: number;
    /**
     * How Fastify treats open connections on close: `"idle"` closes idle
     * keep-alive connections and lets active requests finish, `true`
     * force-closes everything, `false` waits for every connection.
     *
     * @default "idle"
     */
    forceCloseConnections?: boolean | "idle";
  };
  /**
   * Built-in liveness (`/health`) and readiness (`/ready`) endpoints.
   */
  health?: {
    /**
     * Toggle the built-in health endpoints.
     *
     * @default true
     */
    enabled?: boolean;
    /**
     * Liveness endpoint path — 200 while the process is up, 503 once shutdown
     * has begun.
     *
     * @default "/health"
     */
    path?: string;
    /**
     * Readiness endpoint path — 200 once booted with all checks passing, 503
     * before boot, during shutdown, or on any failing check.
     *
     * @default "/ready"
     */
    readinessPath?: string;
  };
  /**
   * Host
   */
  host?: string;
  /**
   * Http middlewares list
   */
  middleware?: {
    /**
     * All middlewares that are passed to `all` array will be applied to all routes
     */
    all?: Middleware[];
    /**
     * Middlewares that are passed to `only` object will be applied to specific routes
     */
    only?: PartialMiddleware;
    /**
     * Middlewares that are passed to `except` object will be excluded from specific routes
     */
    except?: PartialMiddleware;
  };
  /**
   * Opt-in request tracing hooks. OFF by default; resolved
   * once at boot, not per request — see `resolveTracingConfig` in
   * `./tracing/tracing-dispatcher.ts`.
   */
  tracing?: HttpTracingConfig;
}

/**
 * Options for `response.stream()`.
 */
export type ResponseStreamOptions = StreamQueueOptions & {
  /** Application/cache headers override defaults before flushing; framing and connection headers are ignored. */
  headers?: Record<string, string>;
  /**
   * How many of the most recent chunks (from `send()`, `write()` and
   * `render()`) to keep on `response.body` after `end()`, for logging and
   * debugging. Written chunks are otherwise not kept, so a long-lived stream
   * does not grow with its own history.
   *
   * @default 0
   */
  retainChunks?: number;
};

export type ResponseStreamController = {
  /**
   * Send data to the client. Does not wait for the client; for long-lived or
   * high-volume streams use `write()` (or `drain()`) so the producer slows
   * down to the client's pace instead of buffering. A silent no-op after the
   * client disconnected; throws after `end()`.
   */
  send: (data: string | Uint8Array) => void;
  /** Bounded synchronous write; false when closed or overflow rejects this chunk. */
  enqueue: (data: string | Uint8Array) => boolean;
  /**
   * Send data and wait until the transport can take more. Resolves `true`
   * when it can, `false` when the stream ended or the client disconnected —
   * stop producing then. In drop mode, true means the stream is ready to continue;
   * inspect dropped to detect rejected output and schedule a resync.
   */
  write: (data: string | Uint8Array) => Promise<boolean>;
  /**
   * Render a view and send it to the client
   */
  render: (view: React.ReactNode) => void;
  /**
   * Wait until output buffered for the client has been flushed. Resolves
   * `true` immediately when nothing is backed up, `false` when the stream
   * ended or the client disconnected.
   */
  drain: () => Promise<boolean>;
  /**
   * End the stream
   */
  end: () => void;
  /**
   * Register a handler to be called when the client disconnects
   */
  onDisconnect: (handler: () => void) => ResponseStreamController;
  /**
   * Aborted when the client disconnects (not when `end()` is called). Pass it
   * to the work feeding the stream.
   */
  signal: AbortSignal;
  /**
   * Whether the transport is currently holding more than its high-water mark.
   */
  backpressured: boolean;
  /** Chunks/events/comments rejected by onOverflow: "drop", including send/write/render paths. */
  readonly dropped: number;
  /**
   * Detect whether stream is ended (by `end()` or a client disconnect)
   */
  ended: boolean;
};

/**
 * Options for `response.sse()`.
 */
export type ResponseSSEOptions = StreamQueueOptions & {
  /** Application/cache headers override defaults before flushing; framing and connection headers are ignored. */
  headers?: Record<string, string>;
  /**
   * How many of the most recent events to keep on `response.body` after
   * `end()`, for logging and debugging. Sent events are otherwise not kept,
   * so a long-lived stream does not grow with its own history.
   *
   * @default 0
   */
  retainEvents?: number;
};

/** Wire serialization for one SSE event. Raw strings are split into safe data lines. */
export type ResponseSSEMessageOptions = { raw?: boolean };

export type ResponseSSEController = {
  /**
   * Send an SSE event to the client. Does not wait for the client; for
   * long-lived or high-volume streams use `write()` (or `drain()`) so the
   * producer slows down to the client's pace instead of buffering.
   * @param event - Event name
   * @param data - Event data (will be JSON stringified)
   * @param id - Optional event ID for client-side Last-Event-ID tracking
   */
  send: (
    event: string | undefined,
    data: any,
    id?: string,
    options?: ResponseSSEMessageOptions,
  ) => ResponseSSEController;
  /** Bounded synchronous event; undefined event omits the event field. */
  enqueue: (
    event: string | undefined,
    data: unknown,
    id?: string,
    options?: ResponseSSEMessageOptions,
  ) => boolean;
  /**
   * Send an SSE event and wait until the transport can take more.
   * Resolves `true` when it can, `false` when the stream ended or the client
   * disconnected — stop producing then. In drop mode, true means ready to continue;
   * inspect dropped to detect rejected output and schedule a resync.
   */
  write: (
    event: string | undefined,
    data: any,
    id?: string,
    options?: ResponseSSEMessageOptions,
  ) => Promise<boolean>;
  /**
   * Wait until output buffered for the client has been flushed. Resolves
   * `true` immediately when nothing is backed up, `false` when the stream
   * ended or the client disconnected.
   */
  drain: () => Promise<boolean>;
  /**
   * Aborted when the client disconnects (not when `end()` is called). Pass it
   * to the work feeding the stream.
   */
  signal: AbortSignal;
  /**
   * Whether the transport is currently holding more than its high-water mark.
   */
  backpressured: boolean;
  /** Chunks/events/comments rejected by onOverflow: "drop", including send/write/render paths. */
  readonly dropped: number;
  /**
   * Send a comment to keep the connection alive (invisible to client)
   */
  comment: (comment: string) => ResponseSSEController;
  /**
   * End the SSE stream
   */
  end: () => ResponseSSEController;
  /**
   * Register a handler to be called when the client disconnects
   * Use this to clean up resources (e.g., EventEmitter listeners, background jobs)
   */
  onDisconnect: (handler: () => void) => ResponseSSEController;
  /**
   * Detect whether stream is ended
   */
  ended: boolean;
};
