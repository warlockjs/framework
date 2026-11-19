import type { FastifyReply, FastifyRequest } from "fastify";
import type { DevtoolsInstanceInfo, DevtoolsRole, DevtoolsSessionStage } from "../contracts";
import type { DevtoolsAuthService } from "../auth/types";
import type { DevtoolsProductionCapture } from "../capture/types";
import type { DevtoolsInsights } from "../insights/types";
import type { ResolvedDevtoolsProductionOptions } from "../options";
import type { DevtoolsStore } from "../store/types";
import type { MountedDevtoolsPanel } from "../../panels";
import type { MountDevtoolsRoutesDeps } from "../../server/types";

/**
 * Who may call a dashboard route in production.
 *
 * - `public`: anyone who passes the gate (open, unlocked, HTTPS, allowed IP):
 *   the shell page, its assets, `api/auth/session`, login, setup, invite.
 * - `pending`: a session in one of `stages` (sign-in steps), or active.
 * - `viewer`: an active session of any role.
 * - `admin`: an active admin session.
 * - `share`: a valid read-only share grant (the share cookie), no account.
 *
 * A route with no entry in the access table is `admin` (fail closed).
 */
export type DevtoolsRouteAccess =
  | { type: "public" }
  | { type: "pending"; stages: readonly Exclude<DevtoolsSessionStage, "signed-out" | "active">[] }
  | { type: "viewer" }
  | { type: "admin" }
  | { type: "share" };

/** One row of the production access table: method + Fastify URL pattern (relative to the dashboard path). */
export type DevtoolsRouteAccessRule = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** e.g. `/api/requests/:id`. */
  url: string;
  access: DevtoolsRouteAccess;
  /** Write an audit entry of this type when the route succeeds. */
  audit?: "explain.run" | "requests.cleared" | "panel.action";
};

/** The cached open/closed state every request checks. */
export interface DevtoolsDashboardState {
  /** `false` while disabled for this path or globally locked. Re-read from the store at most every `ttlMs` (5 s). */
  isOpen(): Promise<boolean>;
  /** Forget the cached value (after this process changed the state). */
  invalidate(): void;
}

/** Everything the production mount needs. */
export type MountProductionDevtoolsDeps = {
  /** The development route deps, reused by the shared route files (requests, routes, panels, ai, mail, openapi). */
  routes: MountDevtoolsRoutesDeps;
  production: ResolvedDevtoolsProductionOptions;
  store: DevtoolsStore;
  auth: DevtoolsAuthService;
  capture: DevtoolsProductionCapture;
  insights: DevtoolsInsights;
  instance: DevtoolsInstanceInfo;
  /** Package panels already filtered for production. */
  panels: readonly MountedDevtoolsPanel[];
  /** Built-in tab ids enabled in production (from `DEVTOOLS_BUILT_IN_PANELS` + `production.panels`). */
  builtInPanels: readonly string[];
  state: DevtoolsDashboardState;
  warn?: (message: string) => void;
  /**
   * Answers a refused request the way the app answers an unknown URL (core's
   * `answerUnknownUrl`); resolves `false` when the app has no catch-all route.
   * Without it a refused request gets Fastify's own 404.
   */
  answerUnknownUrl?: (request: FastifyRequest, reply: FastifyReply) => Promise<boolean>;
  /**
   * HMAC-SHA256 of a value, keyed with the app key (core's `hmacHash`):
   * signs the share cookie. Required when `production.share.enabled`.
   */
  hmac?: (value: string) => string;
};

/** The client as the trusted-proxy rules see it. */
export type DevtoolsClientInfo = {
  ip: string;
  /** `http` or `https`. */
  proto: string;
  /** Host name without port, lower case. */
  hostname: string;
  /** `host[:port]` as addressed. */
  host: string;
};

/** The parts of a Fastify request the proxy rules read. */
export type DevtoolsProxyRequest = {
  socket: { remoteAddress?: string | undefined; encrypted?: boolean | undefined };
  headers: Readonly<Record<string, string | string[] | undefined>>;
};

/** The role a route needs, for the dashboard's own checks. */
export type DevtoolsRoleRequirement = DevtoolsRole | "any";
