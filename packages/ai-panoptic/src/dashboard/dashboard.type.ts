/**
 * Options for the local Panoptic {@link dashboard} server.
 *
 * Every field is optional and has a safe default. The dashboard is a dev
 * tool over an in-memory trace store: it binds loopback-only by default
 * (so prompt content is never accidentally exposed to the LAN), serves a
 * single self-contained HTML page, and exposes a tiny read-only JSON API
 * the page polls. There is no auth, persistence, or write surface.
 */
export type DashboardOptions = {
  /**
   * TCP port to listen on. Default `4319`. Pass `0` for an ephemeral
   * port — the OS-assigned port is then returned on
   * {@link DashboardHandle.port}.
   */
  port?: number;
  /**
   * Host / interface to bind. Default `"127.0.0.1"` — loopback only, so
   * the dashboard (and the prompt content it can surface) is never
   * exposed beyond the local machine unless you opt in explicitly.
   */
  host?: string;
  /**
   * Mount-path prefix for the JSON API + UI. Default `"/"`. A non-root
   * value (e.g. `"/panoptic"`) prefixes both the page and every
   * `/api/...` route.
   */
  basePath?: string;
  /**
   * Open the default browser at the resolved URL once the server is
   * listening. Default `false`.
   */
  open?: boolean;
  /** Title shown in the dashboard header. Default `"Panoptic"`. */
  title?: string;
  /**
   * Bearer token required on every request (S4). When set, a request must
   * present `Authorization: Bearer <token>` (or `?token=<token>`), else
   * `401`. **Required** when binding to a non-loopback `host` — starting
   * the dashboard on a public interface without a token throws.
   */
  authToken?: string;
  /**
   * `Host` header allowlist (S4) — defends against DNS-rebinding. A
   * request whose `Host` is not listed gets `403`. Defaults to the
   * loopback names (`localhost`, `127.0.0.1`, `[::1]`) for a loopback
   * bind; for a non-loopback bind you must list the expected host(s).
   */
  allowedHosts?: string[];
};

/**
 * Handle returned by {@link dashboard} once the server is listening.
 * Carries the resolved URL + port (useful when `port: 0` requested an
 * ephemeral one) and a `close()` to release the port.
 */
export type DashboardHandle = {
  /** Resolved URL the UI is served at (`http://host:port{basePath}`). */
  readonly url: string;
  /** Resolved port — the real OS-assigned port when `port: 0` was passed. */
  readonly port: number;
  /** Stop the server and release the port. Resolves once fully closed. */
  close(): Promise<void>;
};
