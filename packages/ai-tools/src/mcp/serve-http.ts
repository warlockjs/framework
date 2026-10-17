import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { isIPv4, isIPv6 } from "node:net";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpHttpAuth,
  McpHttpRequestInfo,
  McpHttpServeTransport,
  McpServeCallContext,
} from "../contracts";
import { McpServeError } from "../errors";
import { SUPPORTED_PROTOCOL_VERSIONS } from "./protocol";

/**
 * MCP Streamable HTTP server transport for `ai.mcp.serve`.
 *
 * Implements the server side of the Streamable HTTP transport from the MCP
 * specification (https://modelcontextprotocol.io/specification/2025-11-25/basic/transports,
 * checked 2026-10-17) on `node:http`, with no SDK dependency:
 *
 * - one endpoint path; each POST carries exactly one JSON-RPC message
 *   (batches were removed from the protocol in 2025-06-18 and get 400);
 * - a request is answered with `Content-Type: application/json` (the spec
 *   lets a server pick JSON or SSE per request); a notification or a
 *   response is acknowledged with `202 Accepted` and no body;
 * - stateless: no `MCP-Session-Id` is issued (optional in the spec), so
 *   GET (server-initiated SSE stream) and DELETE (session end) answer
 *   `405 Method Not Allowed`, as the spec allows;
 * - an unsupported `MCP-Protocol-Version` header gets 400;
 * - security warning items: `Origin` is validated on every request (an
 *   invalid one gets 403), the default bind is `127.0.0.1`, and
 *   authentication is required for any non-loopback bind.
 */

/** Default bind interface — loopback only. */
const DEFAULT_HOST = "127.0.0.1";

/** Default endpoint path. */
const DEFAULT_PATH = "/mcp";

/** Default request body cap: 1 MiB. */
const DEFAULT_MAX_BODY_BYTES = 1_048_576;

/** Default time `close()` waits for in-flight requests. */
const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;

/** JSON-RPC codes used for transport-level error bodies. */
const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;

/** Generic server-defined JSON-RPC code for HTTP-level refusals (auth, origin, size). */
const JSON_RPC_SERVER_ERROR = -32000;

/** Host names that always mean "this machine". */
const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The function the transport pumps each JSON-RPC request through. */
export type McpHttpDispatch = (
  request: JsonRpcRequest,
  context: McpServeCallContext,
) => Promise<JsonRpcResponse>;

/** A bound HTTP endpoint. */
export type RunningMcpHttpServer = {
  /** Full endpoint URL. */
  url: string;
  /** Drain in-flight requests (up to the drain timeout) and free the port. Idempotent. */
  close(): Promise<void>;
};

/**
 * True when `host` names a loopback interface (`localhost`, `127.0.0.0/8`,
 * `::1`, or an IPv4-mapped `::ffff:127.x.x.x`).
 */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();

  if (LOOPBACK_NAMES.has(normalized)) {
    return true;
  }

  const unbracketed = normalized.replace(/^\[|\]$/g, "");
  const mapped = unbracketed.startsWith("::ffff:")
    ? unbracketed.slice("::ffff:".length)
    : unbracketed;

  return isIPv4(mapped) && mapped.startsWith("127.");
}

/** Strip the port from a `Host` header value (`[::1]:3000` → `[::1]`, `a.b:80` → `a.b`). */
function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();

  if (value.startsWith("[")) {
    const end = value.indexOf("]");

    return end === -1 ? value : value.slice(0, end + 1);
  }

  const colon = value.lastIndexOf(":");

  return colon === -1 ? value : value.slice(0, colon);
}

/** SHA-256 digest — equal-length input for `timingSafeEqual`. */
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Validated, defaulted transport settings plus the precomputed security
 * material (token digests, origin / host allowlists).
 */
type ResolvedSettings = {
  host: string;
  port: number;
  path: string;
  loopback: boolean;
  maxBodyBytes: number;
  drainTimeoutMs: number;
  tokenDigests: Buffer[];
  authorize: McpHttpAuth["authorize"];
  authRequired: boolean;
  allowedOrigins: Set<string>;
  allowedHosts: Set<string>;
};

/** Normalise a configured origin to `scheme://host[:port]`, or throw a config error. */
function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch (cause) {
    throw new McpServeError(`allowedOrigins entry "${origin}" is not a valid origin URL.`, {
      type: "config",
      cause,
    });
  }
}

/**
 * Validate and default the transport options. Throws {@link McpServeError}
 * (`"config"`) for a non-loopback bind without auth, an empty bearer
 * token, an `auth` with neither check, a bad path / port / limit.
 */
function resolveSettings(transport: McpHttpServeTransport): ResolvedSettings {
  const host = transport.host ?? DEFAULT_HOST;
  const port = transport.port ?? 0;
  const path = transport.path ?? DEFAULT_PATH;
  const loopback = isLoopbackHost(host);
  const auth = transport.auth;

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new McpServeError(`MCP http port must be an integer in 0–65535 (got ${port}).`, {
      type: "config",
    });
  }

  if (!path.startsWith("/")) {
    throw new McpServeError(`MCP http path must start with "/" (got "${path}").`, {
      type: "config",
    });
  }

  const maxBodyBytes = transport.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new McpServeError("MCP http maxBodyBytes must be a positive integer.", {
      type: "config",
    });
  }

  const drainTimeoutMs = transport.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;

  if (!Number.isFinite(drainTimeoutMs) || drainTimeoutMs < 0) {
    throw new McpServeError("MCP http drainTimeoutMs must be zero or a positive number.", {
      type: "config",
    });
  }

  const tokens =
    auth?.bearer === undefined
      ? []
      : typeof auth.bearer === "string"
        ? [auth.bearer]
        : [...auth.bearer];

  if (tokens.some((token) => token.length === 0)) {
    throw new McpServeError("MCP http auth.bearer tokens must be non-empty strings.", {
      type: "config",
    });
  }

  if (auth && auth.bearer !== undefined && tokens.length === 0) {
    throw new McpServeError("MCP http auth.bearer needs at least one token.", { type: "config" });
  }

  if (auth && tokens.length === 0 && !auth.authorize) {
    throw new McpServeError("MCP http auth needs `bearer` and/or `authorize`.", {
      type: "config",
    });
  }

  const authRequired = tokens.length > 0 || auth?.authorize !== undefined;

  if (!loopback && !authRequired) {
    throw new McpServeError(
      `Refusing to serve MCP over http on non-loopback host "${host}" without auth. ` +
        "Set transport.auth ({ bearer } or { authorize }), or bind 127.0.0.1.",
      { type: "config", context: { host } },
    );
  }

  return {
    host,
    port,
    path,
    loopback,
    maxBodyBytes,
    drainTimeoutMs,
    tokenDigests: tokens.map(digest),
    authorize: auth?.authorize,
    authRequired,
    allowedOrigins: new Set((transport.allowedOrigins ?? []).map(normalizeOrigin)),
    allowedHosts: new Set((transport.allowedHosts ?? []).map((name) => hostnameOf(name))),
  };
}

/** Flatten Node's header bag into lower-cased `name → value` strings. */
function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    flat[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }

  return flat;
}

/** Write a JSON body with a status code. */
function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (response.headersSent || response.destroyed) {
    return;
  }

  const payload = JSON.stringify(body);

  response.writeHead(status, {
    ...headers,
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload).toString(),
  });
  response.end(payload);
}

/**
 * Write an HTTP-level refusal: the status plus a JSON-RPC error body with
 * no request id (the spec allows such a body on 4xx transport errors).
 */
function sendRefusal(
  response: ServerResponse,
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  sendJson(response, status, { jsonrpc: "2.0", id: null, error: { code, message } }, headers);
}

/** Write an empty-bodied status (202 / 405). */
function sendEmpty(
  response: ServerResponse,
  status: number,
  headers: Record<string, string> = {},
): void {
  if (response.headersSent || response.destroyed) {
    return;
  }

  response.writeHead(status, headers);
  response.end();
}

/**
 * Bind an MCP Streamable HTTP endpoint and pump each JSON-RPC request
 * through `dispatch`. Resolves once the port is bound.
 *
 * Throws {@link McpServeError}: `"config"` for invalid / unsafe options
 * (checked before anything binds), `"listen"` when binding fails.
 *
 * @param transport - The http transport options.
 * @param dispatch - Maps one JSON-RPC request (plus call context) to its response.
 */
export async function startHttpServer(
  transport: McpHttpServeTransport,
  dispatch: McpHttpDispatch,
): Promise<RunningMcpHttpServer> {
  const settings = resolveSettings(transport);
  const shutdown = new AbortController();
  const inFlight = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;

  const server: Server = createServer((request, response) => {
    if (closing) {
      sendRefusal(response, 503, JSON_RPC_SERVER_ERROR, "Server is shutting down.", {
        connection: "close",
      });

      return;
    }

    const work = handleRequest(request, response, settings, dispatch, shutdown.signal).catch(() => {
      sendRefusal(response, 500, JSON_RPC_SERVER_ERROR, "Internal server error.");
    });

    inFlight.add(work);
    void work.finally(() => {
      inFlight.delete(work);

      if (closing) {
        server.closeIdleConnections();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (cause: Error) => {
      reject(
        new McpServeError(
          `MCP http server could not listen on ${settings.host}:${settings.port}: ${cause.message}`,
          { type: "listen", cause, context: { host: settings.host, port: settings.port } },
        ),
      );
    };

    server.once("error", onError);
    server.listen(settings.port, settings.host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : settings.port;
  const urlHost = isIPv6(settings.host) ? `[${settings.host}]` : settings.host;
  const url = `http://${urlHost}:${boundPort}${settings.path}`;

  const close = (): Promise<void> => {
    if (closing) {
      return closing;
    }

    closing = (async () => {
      const closed = new Promise<void>((resolve) => {
        server.close(() => resolve());
      });

      server.closeIdleConnections();

      if (inFlight.size > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), settings.drainTimeoutMs);
        });

        const outcome = await Promise.race([
          Promise.allSettled([...inFlight]).then(() => "drained" as const),
          timedOut,
        ]);

        clearTimeout(timer);

        if (outcome === "timeout") {
          shutdown.abort();
          server.closeAllConnections();
        }
      }

      server.closeIdleConnections();
      await closed;
    })();

    return closing;
  };

  return { url, close };
}

/**
 * Validate and answer one HTTP request: path → Host / Origin → auth →
 * method → headers → body → JSON-RPC dispatch.
 */
async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  settings: ResolvedSettings,
  dispatch: McpHttpDispatch,
  signal: AbortSignal,
): Promise<void> {
  const headers = flattenHeaders(request.headers);
  const method = (request.method ?? "GET").toUpperCase();
  const path = new URL(request.url ?? "/", "http://localhost").pathname;

  // DNS-rebinding guards apply to every request on every path.
  if (!hostAllowed(headers.host, settings)) {
    sendRefusal(response, 403, JSON_RPC_SERVER_ERROR, "Forbidden: Host header not allowed.");

    return;
  }

  if (!originAllowed(headers.origin, settings)) {
    sendRefusal(response, 403, JSON_RPC_SERVER_ERROR, "Forbidden: Origin not allowed.");

    return;
  }

  if (path !== settings.path) {
    sendRefusal(response, 404, JSON_RPC_SERVER_ERROR, "Not found.");

    return;
  }

  const info: McpHttpRequestInfo = { method, path, headers };

  if (request.socket.remoteAddress !== undefined) {
    info.remoteAddress = request.socket.remoteAddress;
  }

  if (!(await authorized(info, settings))) {
    const challenge: Record<string, string> =
      settings.tokenDigests.length > 0 ? { "www-authenticate": 'Bearer realm="mcp"' } : {};

    sendRefusal(response, 401, JSON_RPC_SERVER_ERROR, "Unauthorized.", challenge);

    return;
  }

  if (method !== "POST") {
    // Stateless server: no server-initiated SSE stream (GET) and no
    // session to terminate (DELETE). The spec allows 405 for both.
    sendEmpty(response, 405, { allow: "POST" });

    return;
  }

  const protocolVersion = headers["mcp-protocol-version"];

  if (protocolVersion !== undefined && !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
    sendRefusal(
      response,
      400,
      JSON_RPC_SERVER_ERROR,
      `Unsupported MCP-Protocol-Version "${protocolVersion}" (supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}).`,
    );

    return;
  }

  if (!isJsonContentType(headers["content-type"])) {
    sendRefusal(response, 415, JSON_RPC_SERVER_ERROR, "Content-Type must be application/json.");

    return;
  }

  if (!acceptsJson(headers.accept)) {
    sendRefusal(response, 406, JSON_RPC_SERVER_ERROR, "Accept must allow application/json.");

    return;
  }

  const body = await readBody(request, settings.maxBodyBytes);

  if (body.type === "too-large") {
    sendRefusal(
      response,
      413,
      JSON_RPC_SERVER_ERROR,
      `Request body exceeds ${settings.maxBodyBytes} bytes.`,
      { connection: "close" },
    );

    return;
  }

  let message: unknown;

  try {
    message = JSON.parse(body.text);
  } catch {
    sendRefusal(response, 400, JSON_RPC_PARSE_ERROR, "Parse error: body is not valid JSON.");

    return;
  }

  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    sendRefusal(
      response,
      400,
      JSON_RPC_INVALID_REQUEST,
      "Invalid request: the body must be one JSON-RPC message (batches are not supported).",
    );

    return;
  }

  const record = message as Record<string, unknown>;

  if (record.jsonrpc !== "2.0") {
    sendRefusal(response, 400, JSON_RPC_INVALID_REQUEST, 'Invalid request: jsonrpc must be "2.0".');

    return;
  }

  const id = record.id;

  if (typeof record.method === "string") {
    if (typeof id !== "string" && typeof id !== "number") {
      // A notification (notifications/initialized, notifications/cancelled…).
      sendEmpty(response, 202);

      return;
    }

    const rpcRequest: JsonRpcRequest = { jsonrpc: "2.0", id, method: record.method };

    if (record.params !== undefined) {
      rpcRequest.params = record.params;
    }

    const rpcResponse = await dispatch(rpcRequest, { request: info, signal });

    sendJson(response, 200, rpcResponse);

    return;
  }

  if (
    (typeof id === "string" || typeof id === "number") &&
    ("result" in record || "error" in record)
  ) {
    // A response to a server-initiated request; this server sends none, so acknowledge.
    sendEmpty(response, 202);

    return;
  }

  sendRefusal(response, 400, JSON_RPC_INVALID_REQUEST, "Invalid request: not a JSON-RPC message.");
}

/**
 * Host-header check. While bound to loopback only loopback names (plus
 * `allowedHosts`) are accepted, so a DNS-rebound name pointing at
 * 127.0.0.1 is refused. Off loopback the check applies only when
 * `allowedHosts` is set.
 */
function hostAllowed(hostHeader: string | undefined, settings: ResolvedSettings): boolean {
  if (!settings.loopback && settings.allowedHosts.size === 0) {
    return true;
  }

  if (hostHeader === undefined) {
    return false;
  }

  const name = hostnameOf(hostHeader);

  if (settings.allowedHosts.has(name)) {
    return true;
  }

  return settings.loopback && isLoopbackHost(name);
}

/**
 * Origin check (MCP Streamable HTTP security warning). No `Origin` header —
 * a non-browser client — passes; otherwise the origin must be a loopback
 * `http(s)` origin or listed in `allowedOrigins`. `null` and unparsable
 * origins are refused.
 */
function originAllowed(origin: string | undefined, settings: ResolvedSettings): boolean {
  if (origin === undefined) {
    return true;
  }

  let parsed: URL;

  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (settings.allowedOrigins.has(parsed.origin)) {
    return true;
  }

  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopbackHost(parsed.hostname)
  );
}

/**
 * Run the configured auth. Bearer tokens are compared in constant time
 * over SHA-256 digests (equal-length buffers for `timingSafeEqual`), and
 * every configured token is compared so the match position does not leak.
 * An `authorize` hook that throws denies the request.
 */
async function authorized(info: McpHttpRequestInfo, settings: ResolvedSettings): Promise<boolean> {
  if (!settings.authRequired) {
    return true;
  }

  if (settings.tokenDigests.length > 0) {
    const match = /^Bearer[ \t]+(.+)$/i.exec(info.headers.authorization ?? "");
    const presented = digest(match?.[1]?.trim() ?? "");
    let matched = false;

    for (const expected of settings.tokenDigests) {
      matched = timingSafeEqual(presented, expected) || matched;
    }

    if (!match || !matched) {
      return false;
    }
  }

  if (settings.authorize) {
    try {
      return (await settings.authorize(info)) === true;
    } catch {
      return false;
    }
  }

  return true;
}

/** True for `application/json` (any parameters, e.g. `; charset=utf-8`). */
function isJsonContentType(contentType: string | undefined): boolean {
  return contentType?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

/**
 * True when the `Accept` header allows a JSON reply. Clients are required
 * to list both `application/json` and `text/event-stream`; this server
 * always answers JSON, so it only insists on that half. A missing header
 * is accepted.
 */
function acceptsJson(accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === "") {
    return true;
  }

  return accept
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .some((type) => type === "application/json" || type === "application/*" || type === "*/*");
}

/** The outcome of reading a request body. */
type BodyResult = { type: "ok"; text: string } | { type: "too-large" };

/**
 * Read the request body as UTF-8, refusing anything over `limit` bytes —
 * up front from `Content-Length`, and while streaming for chunked bodies.
 * A refused body is left unread; the 413 response closes the connection.
 */
function readBody(request: IncomingMessage, limit: number): Promise<BodyResult> {
  const declared = Number(request.headers["content-length"]);

  if (Number.isFinite(declared) && declared > limit) {
    return Promise.resolve({ type: "too-large" });
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;

    const finish = (result: BodyResult) => {
      if (!done) {
        done = true;
        resolve(result);
      }
    };

    request.on("data", (chunk: Buffer) => {
      if (done) {
        return;
      }

      size += chunk.length;

      if (size > limit) {
        request.pause();
        finish({ type: "too-large" });

        return;
      }

      chunks.push(chunk);
    });
    request.on("end", () => finish({ type: "ok", text: Buffer.concat(chunks).toString("utf8") }));
    request.on("error", (error) => {
      if (!done) {
        done = true;
        reject(error);
      }
    });
  });
}
