import type { FastifyInstance } from "fastify";
import type { DevtoolsStore } from "../store/types";
import type {
  DevtoolsClientInfo,
  DevtoolsDashboardState,
  DevtoolsProxyRequest,
  DevtoolsRouteAccessRule,
  MountProductionDevtoolsDeps,
} from "./types";

export type * from "./types";

/** The header the dashboard sends the CSRF token in. */
export const DEVTOOLS_CSRF_HEADER = "x-devtools-csrf";

/** The session cookie name over HTTPS (`__Secure-` makes browsers refuse it over plain HTTP). */
export const DEVTOOLS_SESSION_COOKIE = "__Secure-warlock-devtools";

/** The session cookie name when `requireHttps` is off (local trials only). */
export const DEVTOOLS_SESSION_COOKIE_INSECURE = "warlock-devtools";

/**
 * Mounts the production monitor under `production.path` in one encapsulated
 * Fastify context: the gate (uniform 404, HTTPS, allowed IPs, open state),
 * session and role checks from the access table, CSRF and origin checks,
 * security headers and CORS stripping, the auth/account/admin routes, and
 * the shared data routes of the enabled tabs.
 *
 * Owner: WP-3.
 */
export function mountProductionDevtools(
  _server: FastifyInstance,
  _deps: MountProductionDevtoolsDeps,
): void {
  throw new Error("not implemented");
}

/** The access table: every production route, its method and who may call it. Owner: WP-3. */
export function productionRouteAccess(_panelIds: readonly string[]): DevtoolsRouteAccessRule[] {
  throw new Error("not implemented");
}

/**
 * The client IP, protocol and host. Forwarding headers are read only when the
 * socket peer is a trusted proxy; `X-Forwarded-For` is walked right to left,
 * skipping trusted addresses, and the first untrusted one is the client.
 *
 * Owner: WP-3.
 */
export function resolveClient(
  _request: DevtoolsProxyRequest,
  _trustedProxies: readonly string[],
): DevtoolsClientInfo {
  throw new Error("not implemented");
}

/** Whether `address` matches an entry: an IP, a CIDR, `"loopback"` or `"private"`. IPv4-mapped IPv6 is unwrapped. Owner: WP-3. */
export function ipMatches(_address: string, _entries: readonly string[]): boolean {
  throw new Error("not implemented");
}

/** The open/closed state with a `ttlMs` cache (default 5000). Owner: WP-3. */
export function createDashboardState(
  _store: DevtoolsStore,
  _path: string,
  _options?: { ttlMs?: number; now?: () => number },
): DevtoolsDashboardState {
  throw new Error("not implemented");
}

/** `Set-Cookie` value for a session token (or a clearing cookie when `token` is `null`). Owner: WP-3. */
export function sessionCookie(
  _token: string | null,
  _options: { path: string; secure: boolean },
): string {
  throw new Error("not implemented");
}
