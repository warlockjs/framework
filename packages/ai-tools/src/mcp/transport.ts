import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { JsonRpcId, JsonRpcRequest, JsonRpcResponse, McpTransport } from "../contracts";
import { McpTransportError } from "../errors";
import type { McpTransportClient } from "./transport.type";

/** Default per-request wait before a transport call is abandoned. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** The JSON-RPC version literal every outbound message carries. */
const JSONRPC_VERSION = "2.0";

/**
 * The only host environment entries a stdio MCP server inherits. This keeps
 * executable lookup and platform runtime behaviour intact without exposing
 * application secrets or arbitrary parent-process configuration to children.
 */
const STDIO_ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "PATHEXT",
] as const;

/**
 * Build the environment passed to a child MCP stdio server. Never forward
 * `process.env` wholesale: only the cross-platform execution essentials are
 * copied, and application-supplied server variables take precedence.
 */
function createStdioEnvironment(
  serverEnvironment?: Record<string, string>,
): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const key of STDIO_ENV_ALLOWLIST) {
    const value = process.env[key];

    if (value !== undefined) {
      environment[key] = value;
    }
  }

  return { ...environment, ...serverEnvironment };
}

/**
 * A pending in-flight request awaiting its correlated response, keyed by
 * the JSON-RPC `id`. The stdio transport multiplexes many requests over
 * one line-framed pipe, so each resolve/reject is parked here until the
 * line whose `id` matches arrives.
 */
interface PendingCall {
  resolve(response: JsonRpcResponse): void;
  reject(error: McpTransportError): void;
  /** Clears the per-call timeout + abort wiring when the call settles. */
  cleanup(): void;
}

/**
 * Wire a per-call timeout and an optional caller `AbortSignal` onto a
 * pending request, returning a `cleanup()` that tears both down. The
 * `onSettle` callback removes the pending entry from whatever registry the
 * transport keeps so a late response can't double-settle.
 */
function armCall(
  reject: (error: McpTransportError) => void,
  method: string,
  options: { signal?: AbortSignal; timeoutMs?: number } | undefined,
  onSettle: () => void,
): () => void {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  const timer = setTimeout(() => {
    onSettle();
    reject(
      new McpTransportError(`MCP request "${method}" timed out after ${timeoutMs}ms.`, {
        type: "timeout",
        method,
      }),
    );
  }, timeoutMs);

  const onAbort = () => {
    cleanup();
    reject(
      new McpTransportError(`MCP request "${method}" was aborted.`, {
        type: "closed",
        method,
      }),
    );
  };

  const signal = options?.signal;

  if (signal) {
    if (signal.aborted) {
      // Defer so the caller has the rejection wired before it fires.
      queueMicrotask(onAbort);
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  function cleanup(): void {
    clearTimeout(timer);

    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  }

  return cleanup;
}

/**
 * The stdio transport — spawns a child process and speaks JSON-RPC over
 * its stdin/stdout, one JSON object per line (newline-delimited framing).
 * Uses only Node built-ins (`node:child_process` + `node:readline`); no
 * dependency.
 *
 * Constructed via {@link createStdioTransport}; the class itself is
 * internal.
 */
class StdioTransport implements McpTransportClient {
  /** The spawned server process. */
  private readonly child: ChildProcessWithoutNullStreams;

  /** Line reader over the child's stdout — one JSON-RPC message per line. */
  private readonly reader: Interface;

  /** In-flight requests awaiting a correlated response, keyed by id. */
  private readonly pending = new Map<JsonRpcId, PendingCall>();

  /** Monotonic id source for outbound requests. */
  private nextId = 1;

  /** Flipped once {@link close} runs (or the child exits) so reuse rejects. */
  private closed = false;

  public constructor(transport: Extract<McpTransport, { type: "stdio" }>) {
    let child: ChildProcessWithoutNullStreams;

    try {
      child = spawn(transport.command, transport.args ?? [], {
        // process.env is NOT inherited wholesale: only the
        // STDIO_ENV_ALLOWLIST keys are copied, then the caller's explicit
        // `transport.env` entries are layered on top.
        env: createStdioEnvironment(transport.env),
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);

      throw new McpTransportError(
        `MCP stdio transport could not spawn "${transport.command}": ${message}`,
        { type: "connect", cause },
      );
    }

    this.child = child;
    this.reader = createInterface({ input: child.stdout });

    this.reader.on("line", (line) => this.onLine(line));

    // A child that dies takes every in-flight (and future) call with it.
    child.on("exit", (code) => this.failAll("connect", `child exited with code ${code ?? "null"}`));
    child.on("error", (error) => this.failAll("connect", error.message));
  }

  /**
   * Parse one stdout line and route it to its pending request. Non-JSON
   * lines (a server logging to stdout) and messages with no matching `id`
   * (notifications, stray responses) are ignored — robustness over strictness.
   */
  private onLine(line: string): void {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    let message: JsonRpcResponse;

    try {
      message = JSON.parse(trimmed) as JsonRpcResponse;
    } catch {
      // Not a JSON-RPC line (server diagnostics on stdout) — ignore.
      return;
    }

    if (message.id === undefined || message.id === null) {
      // A notification or a malformed response — nothing to correlate.
      return;
    }

    const call = this.pending.get(message.id);

    if (!call) {
      return;
    }

    this.pending.delete(message.id);
    call.cleanup();
    call.resolve(message);
  }

  /**
   * Reject every pending call (and mark the transport unusable) when the
   * child dies or errors — so a hung server can never leave a caller
   * waiting forever.
   */
  private failAll(type: "connect" | "closed", reason: string): void {
    this.closed = true;

    for (const [id, call] of this.pending) {
      this.pending.delete(id);
      call.cleanup();
      call.reject(new McpTransportError(`MCP stdio transport failed: ${reason}.`, { type }));
    }
  }

  public request<TResult = unknown>(
    request: JsonRpcRequest,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<JsonRpcResponse<TResult>> {
    if (this.closed) {
      return Promise.reject(
        new McpTransportError("MCP stdio transport is closed.", {
          type: "closed",
          method: request.method,
        }),
      );
    }

    const id = request.id;

    return new Promise<JsonRpcResponse<TResult>>((resolve, reject) => {
      const cleanup = armCall(reject, request.method, options, () => this.pending.delete(id));

      this.pending.set(id, {
        resolve: (response) => resolve(response as JsonRpcResponse<TResult>),
        reject,
        cleanup,
      });

      try {
        this.child.stdin.write(`${JSON.stringify(request)}\n`);
      } catch (cause) {
        this.pending.delete(id);
        cleanup();

        const message = cause instanceof Error ? cause.message : String(cause);

        reject(
          new McpTransportError(
            `MCP stdio transport failed to write request "${request.method}": ${message}`,
            { type: "closed", method: request.method, cause },
          ),
        );
      }
    });
  }

  public async notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) {
      throw new McpTransportError("MCP stdio transport is closed.", {
        type: "closed",
        method,
      });
    }

    const notification = { jsonrpc: JSONRPC_VERSION, method, params };
    this.child.stdin.write(`${JSON.stringify(notification)}\n`);
  }

  /** Allocate the next outbound request id. */
  public allocateId(): number {
    return this.nextId++;
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.reader.close();
    this.failAll("closed", "transport closed by caller");
    this.child.kill();
  }
}

/**
 * The Streamable HTTP transport — POSTs each JSON-RPC request to the
 * server endpoint over the global `fetch` (Node 18+) and reads the single
 * JSON response. No SSE-legacy, no WebSocket. Static `headers` (e.g. auth)
 * are sent with every request.
 *
 * Constructed via {@link createHttpTransport}; the class itself is internal.
 */
class HttpTransport implements McpTransportClient {
  /** The server endpoint POST target. */
  private readonly url: string;

  /** Static headers merged into every request (auth, etc.). */
  private readonly headers: Record<string, string>;

  /** Monotonic id source for outbound requests. */
  private nextId = 1;

  public constructor(transport: Extract<McpTransport, { type: "http" }>) {
    this.url = transport.url;
    this.headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...transport.headers,
    };
  }

  public async request<TResult = unknown>(
    request: JsonRpcRequest,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<JsonRpcResponse<TResult>> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const onAbort = () => controller.abort();
    const signal = options?.signal;

    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    let response: Response;

    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (cause) {
      const aborted = controller.signal.aborted;
      const message = cause instanceof Error ? cause.message : String(cause);

      throw new McpTransportError(
        aborted
          ? `MCP request "${request.method}" timed out or was aborted after ${timeoutMs}ms.`
          : `MCP http transport request "${request.method}" failed: ${message}`,
        { type: aborted ? "timeout" : "connect", method: request.method, cause },
      );
    } finally {
      clearTimeout(timer);

      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }

    if (!response.ok) {
      throw new McpTransportError(
        `MCP http transport request "${request.method}" returned HTTP ${response.status}.`,
        { type: "connect", method: request.method, context: { status: response.status } },
      );
    }

    return this.parseBody<TResult>(response, request.method);
  }

  /**
   * Parse the HTTP response body into a JSON-RPC response. Streamable HTTP
   * may answer with either `application/json` (a single response object)
   * or `text/event-stream` (SSE frames); we read the body as text and
   * extract the first JSON object, supporting the common `data: {...}`
   * SSE line shape without a streaming parser.
   */
  private async parseBody<TResult>(
    response: Response,
    method: string,
  ): Promise<JsonRpcResponse<TResult>> {
    const raw = await response.text();
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    const jsonText = contentType.includes("text/event-stream") ? extractSseData(raw) : raw;

    if (!jsonText) {
      throw new McpTransportError(`MCP http transport got an empty response for "${method}".`, {
        type: "protocol",
        method,
      });
    }

    try {
      return JSON.parse(jsonText) as JsonRpcResponse<TResult>;
    } catch (cause) {
      throw new McpTransportError(`MCP http transport got a non-JSON response for "${method}".`, {
        type: "protocol",
        method,
        cause,
      });
    }
  }

  public async notify(method: string, params?: unknown): Promise<void> {
    const notification = { jsonrpc: JSONRPC_VERSION, method, params };

    // A notification expects no response; fire-and-forget but surface a
    // connect failure so a dead endpoint is not silently ignored.
    try {
      await fetch(this.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(notification),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);

      throw new McpTransportError(
        `MCP http transport notification "${method}" failed: ${message}`,
        { type: "connect", method, cause },
      );
    }
  }

  /** Allocate the next outbound request id. */
  public allocateId(): number {
    return this.nextId++;
  }

  public async close(): Promise<void> {
    // Streamable HTTP is stateless per request — nothing persistent to
    // release.
  }
}

/**
 * Pull the first `data:` JSON payload out of an SSE response body. MCP's
 * Streamable HTTP transport answers a single request with one SSE frame
 * carrying the JSON-RPC response; we take the first non-empty `data:`
 * line. Returns an empty string when none is found.
 */
function extractSseData(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed.startsWith("data:")) {
      const payload = trimmed.slice("data:".length).trim();

      if (payload && payload !== "[DONE]") {
        return payload;
      }
    }
  }

  return "";
}

/**
 * Build the concrete {@link McpTransportClient} for an {@link McpTransport}
 * config — a {@link StdioTransport} for `type: "stdio"`, an
 * {@link HttpTransport} for `type: "http"`. The returned client also
 * carries an `allocateId()` for the JSON-RPC client to mint request ids.
 *
 * @param transport - The transport config (discriminated by `type`).
 * @returns A transport client paired with its id allocator.
 */
export function createTransport(
  transport: McpTransport,
): McpTransportClient & { allocateId(): number } {
  if (transport.type === "stdio") {
    return new StdioTransport(transport);
  }

  return new HttpTransport(transport);
}

/**
 * A minimal JSON-RPC 2.0 request/response client over any
 * {@link McpTransportClient}. Mints monotonic ids, frames the
 * `{ jsonrpc, id, method, params }` envelope, and unwraps the response —
 * translating a JSON-RPC `error` member into a typed
 * {@link McpTransportError} so callers branch on `error.type` rather than
 * parsing the wire.
 *
 * Constructed via {@link createJsonRpcClient}; the class itself is internal.
 */
class JsonRpcClient {
  /** The underlying framing transport. */
  private readonly transport: McpTransportClient & { allocateId(): number };

  public constructor(transport: McpTransportClient & { allocateId(): number }) {
    this.transport = transport;
  }

  /**
   * Issue a JSON-RPC `method` call and resolve with its `result`,
   * throwing a typed {@link McpTransportError} on a JSON-RPC error member
   * or a malformed response (neither `result` nor `error`).
   */
  public async call<TResult = unknown>(
    method: string,
    params?: unknown,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<TResult> {
    const request: JsonRpcRequest = {
      jsonrpc: JSONRPC_VERSION,
      id: this.transport.allocateId(),
      method,
      params,
    };

    const response = await this.transport.request<TResult>(request, options);

    if (response.error) {
      throw new McpTransportError(
        `MCP "${method}" failed: ${response.error.message} (code ${response.error.code}).`,
        {
          type: "protocol",
          method,
          context: { code: response.error.code },
          cause: response.error.data,
        },
      );
    }

    if (response.result === undefined) {
      throw new McpTransportError(
        `MCP "${method}" returned a response with neither result nor error.`,
        { type: "protocol", method },
      );
    }

    return response.result;
  }

  /** Send a one-way JSON-RPC notification (no response awaited). */
  public notify(method: string, params?: unknown): Promise<void> {
    return this.transport.notify(method, params);
  }

  /** Close the underlying transport. */
  public close(): Promise<void> {
    return this.transport.close();
  }
}

/**
 * A JSON-RPC client over an MCP transport. Either pass an already-built
 * transport client (tests inject a fake) or an {@link McpTransport} config
 * to spawn/connect a real one.
 */
export interface JsonRpcClientHandle {
  /** Issue a request and resolve with its `result` (throws on error). */
  call<TResult = unknown>(
    method: string,
    params?: unknown,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<TResult>;
  /** Send a one-way notification. */
  notify(method: string, params?: unknown): Promise<void>;
  /** Close the underlying transport. */
  close(): Promise<void>;
}

/**
 * Build a {@link JsonRpcClientHandle} over a transport. Accepts either a
 * pre-built {@link McpTransportClient} (the test seam — inject a scripted
 * fake) or an {@link McpTransport} config, in which case the concrete
 * transport is constructed via {@link createTransport}.
 *
 * When a bare {@link McpTransportClient} (without an `allocateId`) is
 * injected, the client supplies its own monotonic id source.
 *
 * @param source - A transport client or an `McpTransport` config.
 * @returns A JSON-RPC client handle.
 */
export function createJsonRpcClient(
  source: McpTransport | McpTransportClient,
): JsonRpcClientHandle {
  const transport: McpTransportClient & { allocateId(): number } = isTransportConfig(source)
    ? createTransport(source)
    : withIdAllocator(source);

  return new JsonRpcClient(transport);
}

/**
 * Distinguish an {@link McpTransport} config (a plain object with a `type`
 * discriminator and no `request` method) from a built
 * {@link McpTransportClient} (which exposes `request`).
 */
function isTransportConfig(source: McpTransport | McpTransportClient): source is McpTransport {
  return typeof (source as McpTransportClient).request !== "function";
}

/**
 * Wrap an injected {@link McpTransportClient} that lacks its own
 * `allocateId` with a monotonic id source, so the JSON-RPC client can mint
 * request ids uniformly regardless of whether the transport was built here
 * or supplied by a test.
 */
function withIdAllocator(
  client: McpTransportClient,
): McpTransportClient & { allocateId(): number } {
  const candidate = client as McpTransportClient & { allocateId?(): number };

  if (typeof candidate.allocateId === "function") {
    return candidate as McpTransportClient & { allocateId(): number };
  }

  let nextId = 1;

  return Object.assign(client, { allocateId: () => nextId++ });
}
