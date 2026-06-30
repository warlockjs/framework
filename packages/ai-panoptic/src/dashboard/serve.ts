import type { IncomingMessage, ServerResponse } from "node:http";
import type { TraceStoreContract } from "../store/trace-store.contract";
import { parseQuery } from "./parse-query";
import { dashboardHtml } from "./ui.html";

/** Fully-resolved routing config the request handler closes over. */
export type ServeConfig = {
  /** Normalized mount path, always ending in `/` (e.g. `"/"`). */
  basePath: string;
  /** Header title baked into the served page. */
  title: string;
  /** Bearer token required on every request when set (S4). */
  authToken?: string;
  /** `Host` header allowlist — defends against DNS-rebinding (S4). */
  allowedHosts: string[];
};

/**
 * Security response headers added to every dashboard response (S4):
 * block MIME-sniffing, framing, referrer leakage, and lock the page's
 * content sources down to itself (the UI is fully self-contained — no CDN).
 */
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

/** Extract the host (no port) from a `Host` header value. */
function hostHeaderName(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined;
  // IPv6 literal `[::1]:4319` → `[::1]`; otherwise strip `:port`.
  if (hostHeader.startsWith("[")) {
    return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  }
  const colon = hostHeader.indexOf(":");
  return colon === -1 ? hostHeader : hostHeader.slice(0, colon);
}

/** Constant-ish bearer-token check from `Authorization` header or `?token=`. */
function isAuthorized(req: IncomingMessage, url: URL, token: string): boolean {
  const header = req.headers.authorization;
  if (header && header === `Bearer ${token}`) return true;
  return url.searchParams.get("token") === token;
}

/**
 * Build the `node:http` request handler for the dashboard over a given
 * trace store. Kept separate from the server lifecycle so it can be unit
 * tested by feeding it a fake `req`/`res` without binding a port.
 *
 * Routes (all under `config.basePath`, all read-only):
 *
 * - `GET api/traces`        → `store.query(parseQuery(searchParams))`
 * - `GET api/traces/:id`    → `store.get(id)` or `404`
 * - `GET api/aggregate`     → `store.aggregate(parseQuery(searchParams))`
 * - `GET {basePath}`        → the self-contained HTML page
 *
 * Anything else → `404`. Non-`GET` methods → `405`. The store shapes
 * ({@link Trace}/{@link TraceSpan}) are already JSON-safe, so responses
 * are a plain `JSON.stringify` with no serializer.
 *
 * @example
 * const handler = createRequestHandler(store, { basePath: "/", title: "Panoptic" });
 * http.createServer(handler).listen(4319, "127.0.0.1");
 */
export function createRequestHandler(
  store: TraceStoreContract,
  config: ServeConfig,
): (req: IncomingMessage, res: ServerResponse) => void {
  const base = config.basePath;
  const apiPrefix = `${base}api`;

  return function handle(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });

      return;
    }

    // `req.url` is path + query only; a dummy origin lets URL parse it.
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    // Host-header allowlist — blocks DNS-rebinding attacks that point a
    // hostile domain at this loopback port (S4).
    const host = hostHeaderName(req.headers.host);
    if (!host || !config.allowedHosts.includes(host.toLowerCase())) {
      sendJson(res, 403, { error: "host_not_allowed" });

      return;
    }

    // Bearer-token auth when configured (always required off loopback, S4).
    if (config.authToken && !isAuthorized(req, url, config.authToken)) {
      sendJson(res, 401, { error: "unauthorized" });

      return;
    }

    if (pathname === `${apiPrefix}/traces`) {
      sendJson(res, 200, store.query(parseQuery(url.searchParams)));

      return;
    }

    if (pathname.startsWith(`${apiPrefix}/traces/`)) {
      const traceId = decodeURIComponent(pathname.slice(`${apiPrefix}/traces/`.length));
      const trace = traceId.length > 0 ? store.get(traceId) : undefined;

      if (trace === undefined) {
        sendJson(res, 404, { error: "trace_not_found", traceId });

        return;
      }

      sendJson(res, 200, trace);

      return;
    }

    if (pathname === `${apiPrefix}/aggregate`) {
      sendJson(res, 200, store.aggregate(parseQuery(url.searchParams)));

      return;
    }

    if (pathname === base || pathname === base.replace(/\/$/, "")) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        ...SECURITY_HEADERS,
      });
      res.end(dashboardHtml(base, config.title));

      return;
    }

    sendJson(res, 404, { error: "not_found" });
  };
}

/** Write a JSON response with the given status code and security headers. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...SECURITY_HEADERS,
  });
  res.end(JSON.stringify(body));
}
