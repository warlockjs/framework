import type { CookieSerializeOptions } from "@fastify/cookie";
import type { FastifyCorsOptions } from "@fastify/cors";
import type React from "react";
import type { Middleware } from "../router";
import type { Response } from "./response";

export type RequestEvent =
  | "executingMiddleware"
  | "executedMiddleware"
  | "executingAction"
  | "executedAction";

/**
 * Private, server-only, per-request data bag — `request.locals`.
 *
 * Empty by default. Augment it via module augmentation, in the module that
 * OWNS the key (not centrally), the same mechanism `RequestUser` and the web
 * layer's `SharedContext` use:
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
export interface RequestLocals {}

/**
 * The authenticated user attached to the current request — `request.user`.
 *
 * Empty by default so any shape is assignable at the declaration site;
 * apps/packages narrow it via module augmentation instead of the v4
 * `GuardedRequest` intersection type (`Request<T> & { user: User }`,
 * hand-declared per app):
 *
 * @example
 * ```typescript
 * declare module "@warlock.js/core" {
 *   interface RequestUser {
 *     id: string | number;
 *   }
 * }
 * ```
 */
export interface RequestUser {}

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
 * Http Configurations list
 */
export interface HttpConfigurations {
  /**
   * Server port
   */
  port?: number;
  /**
   * Log requests
   */
  log?: boolean;
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
   * - `number` — trust that many rightmost hops (an edge that APPENDS to
   *   `X-Forwarded-For`; `2` = "my CDN plus my load balancer").
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
  trustProxy?: boolean | number | string | string[] | ((address: string, hop: number) => boolean);
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
   * Rate limit
   */
  rateLimit?: {
    /**
     * max number of connections during windowMs milliseconds before sending a 429 response
     *
     * @default 60
     */
    max?: number;
    /**
     * how long to keep records of requests in memory
     *
     * @default 60 * 1000
     */
    duration?: number;
  };
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
}

export type ResponseStreamController = {
  /**
   * Send data to the client
   */
  send: (data: string) => void;
  /**
   * Render a view and send it to the client
   */
  render: (view: React.ReactNode) => void;
  /**
   * End the stream
   */
  end: () => void;
  /**
   * Detect whether stream is ended
   */
  ended: boolean;
};

export type ResponseSSEController = {
  /**
   * Send an SSE event to the client
   * @param event - Event name
   * @param data - Event data (will be JSON stringified)
   * @param id - Optional event ID for client-side Last-Event-ID tracking
   */
  send: (event: string, data: any, id?: string) => ResponseSSEController;
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
