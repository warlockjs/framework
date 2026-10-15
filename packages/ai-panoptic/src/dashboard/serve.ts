import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { EvaluateConfig } from "../evaluate/evaluate.type";
import { evaluateSystemPrompt } from "../evaluate/evaluate-system-prompt";
import { extractLastSystemPrompt } from "../evaluate/extract-last-system-prompt";
import { findSpanById } from "../evaluate/find-span-by-id";
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
  /**
   * Enables the one write route: `POST
   * {basePath}api/traces/:traceId/spans/:spanId/evaluate`. Absent ⇒ the
   * route 405s (POST isn't accepted by any route) and the served page never
   * renders the Evaluate button.
   */
  evaluate?: EvaluateConfig;
};

/** Request body accepted by the evaluate route — everything optional. */
type EvaluateRequestBody = {
  /** Per-run instructions override; falls back to `config.evaluate.instructions`. */
  instructions?: string;
};

/** Hard cap on the evaluate route's request body — well beyond a real instructions string. */
const MAX_EVALUATE_BODY_BYTES = 64 * 1024;

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

/**
 * Constant-time string equality (S4) — guards against a timing
 * side-channel that could otherwise let a network-adjacent attacker
 * recover the token byte-by-byte via repeated timed guesses. Plain `===`
 * short-circuits on the first differing byte, so response latency leaks
 * how many leading bytes matched; `timingSafeEqual` does not. Lengths are
 * compared first (a length mismatch is not secret and `timingSafeEqual`
 * requires equal-length buffers anyway).
 */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) return false;

  return timingSafeEqual(bufA, bufB);
}

/**
 * Bearer-token check (S4): `Authorization: Bearer <token>` header, or
 * (only when `allowQueryToken`) a `?token=` query param.
 *
 * The query-string form only exists for the one request that structurally
 * cannot carry a custom header — the initial browser navigation that
 * loads the HTML shell (a typed/clicked/bookmarked URL). Every other
 * request the served page makes is same-origin `fetch()`, which can and
 * does set `Authorization` (see `ui.html.ts`'s `fetchAuthed`), so the API
 * routes never need to accept a query-string token. Restricting the
 * fallback to just the page route minimizes the token's exposure in
 * server access logs, proxy logs, and browser history to a single route
 * instead of every poll.
 */
function isAuthorized(
  req: IncomingMessage,
  url: URL,
  token: string,
  allowQueryToken: boolean,
): boolean {
  const header = req.headers.authorization;
  if (header && constantTimeEqual(header, `Bearer ${token}`)) return true;
  if (!allowQueryToken) return false;
  const queryToken = url.searchParams.get("token");
  return queryToken !== null && constantTimeEqual(queryToken, token);
}

/**
 * Build the `node:http` request handler for the dashboard over a given
 * trace store. Kept separate from the server lifecycle so it can be unit
 * tested by feeding it a fake `req`/`res` without binding a port.
 *
 * Routes (all under `config.basePath`):
 *
 * - `GET api/traces`        → `store.query(parseQuery(searchParams))`
 * - `GET api/traces/:id`    → `store.get(id)` or `404`
 * - `GET api/aggregate`     → `store.aggregate(parseQuery(searchParams))`
 * - `GET {basePath}`        → the self-contained HTML page
 * - `POST api/traces/:traceId/spans/:spanId/evaluate` → ONLY when
 *   `config.evaluate` is set; grades the span's last captured system
 *   prompt and returns a {@link EvaluateVerdict}. The dashboard's one
 *   write route — absent config, POST 405s like it would against any
 *   other route (the path is never even pattern-matched).
 *
 * Anything else → `404`. A method the matched route doesn't accept → `405`.
 * Host allowlist + bearer-token auth (S4) are checked for EVERY request,
 * regardless of method, before any routing. The store shapes
 * ({@link Trace}/{@link TraceSpan}) are already JSON-safe, so GET responses
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
    // `req.url` is path + query only; a dummy origin lets URL parse it.
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    // Host-header allowlist — blocks DNS-rebinding attacks that point a
    // hostile domain at this loopback port (S4). Checked for every method.
    const host = hostHeaderName(req.headers.host);
    if (!host || !config.allowedHosts.includes(host.toLowerCase())) {
      sendJson(res, 403, { error: "host_not_allowed" });

      return;
    }

    // Bearer-token auth when configured (always required off loopback, S4).
    // `?token=` is only honored on the HTML page route — see `isAuthorized`.
    const isPageRoute = pathname === base || pathname === base.replace(/\/$/, "");
    if (config.authToken && !isAuthorized(req, url, config.authToken, isPageRoute)) {
      sendJson(res, 401, { error: "unauthorized" });

      return;
    }

    // The one write route — opt-in via `config.evaluate`, so it must be
    // checked before the blanket GET-only gate below.
    if (req.method === "POST" && config.evaluate) {
      const match = matchEvaluatePath(pathname, apiPrefix);

      if (match) {
        void handleEvaluate(store, config.evaluate, match.traceId, match.spanId, req, res);

        return;
      }
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });

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
      res.end(dashboardHtml(base, config.title, Boolean(config.evaluate), config.evaluate?.instructions ?? ""));

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

/**
 * Match `{apiPrefix}/traces/:traceId/spans/:spanId/evaluate` — the one
 * write route. Returns `undefined` for anything else, including the plain
 * `{apiPrefix}/traces/:id` read route (no `/spans/.../evaluate` suffix),
 * so the two never collide.
 */
function matchEvaluatePath(
  pathname: string,
  apiPrefix: string,
): { traceId: string; spanId: string } | undefined {
  const prefix = `${apiPrefix}/traces/`;

  if (!pathname.startsWith(prefix)) {
    return undefined;
  }

  const match = /^([^/]+)\/spans\/([^/]+)\/evaluate$/.exec(pathname.slice(prefix.length));

  if (!match) {
    return undefined;
  }

  return {
    traceId: decodeURIComponent(match[1]),
    spanId: decodeURIComponent(match[2]),
  };
}

/**
 * Collect and JSON-parse a request body, capped at
 * {@link MAX_EVALUATE_BODY_BYTES} so an oversized body can't hold the
 * connection open indefinitely. An empty body resolves to `undefined` —
 * the evaluate route treats that as "no per-run override".
 */
function readJsonBody<T>(req: IncomingMessage): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;

      if (size > MAX_EVALUATE_BODY_BYTES) {
        req.destroy();
        reject(new Error("payload_too_large"));

        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);

        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T);
      } catch {
        reject(new Error("invalid_json"));
      }
    });

    req.on("error", reject);
  });
}

/**
 * Handle `POST {apiPrefix}/traces/:traceId/spans/:spanId/evaluate`. Looks
 * up the trace + span, extracts its last captured system prompt, and
 * grades it via {@link evaluateSystemPrompt}. `judgePromptBody` itself
 * never throws (a broken judge degrades to an issues-only outcome) — the
 * try/catch here only guards `config.evaluate.model` resolution, the one
 * step that CAN throw (e.g. a factory constructing an SDK client).
 */
async function handleEvaluate(
  store: TraceStoreContract,
  evaluate: EvaluateConfig,
  traceId: string,
  spanId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const trace = store.get(traceId);

  if (trace === undefined) {
    sendJson(res, 404, { error: "trace_not_found", traceId });

    return;
  }

  const span = findSpanById(trace.root, spanId);

  if (span === undefined) {
    sendJson(res, 404, { error: "span_not_found", spanId });

    return;
  }

  const systemPrompt = extractLastSystemPrompt(span);

  if (systemPrompt === undefined) {
    sendJson(res, 422, { error: "no_system_prompt" });

    return;
  }

  let body: EvaluateRequestBody | undefined;

  try {
    body = await readJsonBody<EvaluateRequestBody>(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_json";
    sendJson(res, message === "payload_too_large" ? 413 : 400, { error: message });

    return;
  }

  try {
    const verdict = await evaluateSystemPrompt(systemPrompt, evaluate, body?.instructions);
    sendJson(res, 200, verdict);
  } catch (error) {
    sendJson(res, 502, {
      error: "evaluate_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
