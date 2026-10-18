import type { ToolContract } from "@warlock.js/ai";

/**
 * Type contracts for the Model Context Protocol surface — the
 * `ai.mcp(server)` client and `ai.mcp.serve(source)` server. Pure
 * declarations only; the factories live outside `contracts/`.
 *
 * **`type`, never `kind`.** MCP's own wire vocabulary uses `kind` in
 * some content / capability descriptors. This package translates any
 * inbound `kind` to `type` at the transport boundary and never emits
 * `kind` from the types it owns — every discriminator below is `type`.
 */

/**
 * How the MCP client reaches a server. Discriminated by `type`.
 *
 * - `"stdio"` — spawn `command` (+ `args`) as a child process and speak
 *   JSON-RPC over its stdin/stdout (uses `node:child_process` +
 *   `node:readline`; no dependency).
 * - `"http"` — Streamable HTTP transport against `url`.
 */
export type McpTransport =
  | {
      /** stdio transport — a spawned child process. */
      type: "stdio";
      /** Executable to spawn (e.g. `"npx"`). */
      command: string;
      /** Arguments passed to `command`. */
      args?: string[];
      /**
       * Additional environment for the child. Explicit values override the
       * minimal execution allowlist inherited from the parent (PATH, home,
       * SystemRoot equivalents). Other host variables are not inherited.
       */
      env?: Record<string, string>;
    }
  | {
      /** Streamable HTTP transport. */
      type: "http";
      /** The server endpoint URL. */
      url: string;
      /** Static headers sent with every request (e.g. auth). */
      headers?: Record<string, string>;
    };

/**
 * Options for the `ai.mcp(server, options)` client (Direction A:
 * external server → local agent tools).
 */
export interface McpClientOptions {
  /**
   * Prefix prepended to each remote tool name to avoid colliding with
   * local tools, e.g. `"github."`. The author owns uniqueness — there
   * is no runtime collision guard.
   */
  namePrefix?: string;
  /** Only adapt tools whose (unprefixed) name passes this filter. */
  filter?: (toolName: string) => boolean;
  /**
   * Per-call timeout for `tools/call`, in milliseconds.
   *
   * @default 30_000
   */
  timeoutMs?: number;
  /**
   * Bind the client's lifetime to a run. When it aborts, the client
   * closes its transport (kills the stdio child / ends the HTTP session),
   * in-flight requests reject, and later `tools()` / tool calls fail with
   * an `McpTransportError` of type `"closed"`. Every `tools/call` also
   * honors it, alongside the per-call `ctx.signal` the agent passes.
   *
   * @example
   * const controller = new AbortController();
   * const github = ai.mcp(server, { signal: controller.signal });
   * await agent.execute(task, { signal: controller.signal, tools: await github.tools() });
   * controller.abort(); // also shuts the MCP server down
   */
  signal?: AbortSignal;
}

/**
 * The client handle returned by `ai.mcp(server, options)`.
 */
export interface McpClient {
  /**
   * Lazily run the `initialize` handshake + `tools/list`, mapping each
   * remote tool to a {@link ToolContract}. Cached after the first call.
   */
  tools(): Promise<ToolContract[]>;
  /** Close the underlying transport (kills the child / ends the HTTP session). */
  close(): Promise<void>;
}

// ============================================================
// Minimal JSON-RPC 2.0 wire types
// ============================================================
//
// MCP rides on JSON-RPC 2.0. We model only the slice this package
// needs — `initialize`, `tools/list`, `tools/call` — rather than the
// full protocol. Discriminators are `type`, never `kind`.

/** The JSON-RPC version literal every message carries. */
export type JsonRpcVersion = "2.0";

/** A JSON-RPC id — a string or number (we never send notifications with `null`). */
export type JsonRpcId = string | number;

/**
 * A JSON-RPC request: a method invocation that expects a response.
 */
export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
  /** The RPC method name, e.g. `"tools/list"`. */
  method: string;
  /** Method parameters; shape is method-specific. */
  params?: TParams;
}

/**
 * A JSON-RPC notification: a method invocation with no response.
 */
export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: JsonRpcVersion;
  /** The RPC method name. */
  method: string;
  /** Method parameters; shape is method-specific. */
  params?: TParams;
}

/**
 * A JSON-RPC error object, carried in an error response.
 */
export interface JsonRpcError {
  /** Numeric error code per the JSON-RPC spec. */
  code: number;
  /** Human-readable error message. */
  message: string;
  /** Optional structured error data. */
  data?: unknown;
}

/**
 * A JSON-RPC response — exactly one of `result` / `error` is present.
 */
export interface JsonRpcResponse<TResult = unknown> {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
  /** Present on success. */
  result?: TResult;
  /** Present on failure. */
  error?: JsonRpcError;
}

/**
 * Any inbound JSON-RPC message the transport may surface.
 */
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/**
 * One tool descriptor as returned by an MCP server's `tools/list`. Its
 * `inputSchema` is a JSON Schema object the client converts into a
 * Standard Schema for the adapted {@link ToolContract}.
 */
export interface McpToolDescriptor {
  /** The remote tool's name (before any `namePrefix`). */
  name: string;
  /** Human-readable description forwarded to the LLM. */
  description?: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema?: Record<string, unknown>;
  /** JSON Schema for structured results, when declared by the server. */
  outputSchema?: Record<string, unknown>;
}

/**
 * One content block in an MCP `tools/call` result. MCP's wire field is
 * `type` here already (`"text"`, `"image"`, …); where a server uses
 * `kind` for a content variant, the client maps it onto `type` so our
 * shapes only ever expose `type`.
 */
export interface McpContentBlock {
  /** The content variant (`"text"`, `"image"`, `"resource"`, …). */
  type: string;
  /** Text payload, present for `type: "text"`. */
  text?: string;
  /** Any further variant-specific fields, left opaque. */
  [extra: string]: unknown;
}

/**
 * The `result` payload of an MCP `tools/call`. `isError: true` signals a
 * tool-level failure the client rethrows so `tool()` wraps it as a
 * {@link import("@warlock.js/ai").ToolExecutionError}.
 */
export interface McpToolCallResult {
  /** Ordered content blocks produced by the tool. */
  content: McpContentBlock[];
  /** True when the call represents a tool-level error. */
  isError?: boolean;
  /** Structured tool output (governed by the tool's outputSchema, if present). */
  structuredContent?: Record<string, unknown>;
  /** Protocol metadata forwarded without interpretation. */
  _meta?: Record<string, unknown>;
}
