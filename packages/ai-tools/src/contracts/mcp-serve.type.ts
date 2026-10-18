import type { JsonSchemaTarget, ToolContract, ToolRequestContext } from "@warlock.js/ai";
import type { McpContentBlock } from "./mcp.type";

/**
 * Type contracts for `ai.mcp.serve(source, options)` — exposing local
 * tools (plus optional resources and prompts) AS a Model Context Protocol
 * server over stdio or Streamable HTTP. Pure declarations only; the
 * factories live in `../mcp/serve.ts` and `../mcp/serve-http.ts`.
 */

/**
 * One set of tools: an object that can enumerate its `ToolContract`s (a
 * built agent / supervisor / orchestrator / workspace), or a literal array.
 */
export type McpToolSource = { tools(): ToolContract[] } | ToolContract[];

/**
 * Several named tool sets served by one server. Each key names a group;
 * with `prefixToolNames` the group name is prepended to its tools' names
 * so equal names from different groups stay distinct.
 *
 * @example
 * { groups: { github: githubAgent, files: [readFile, writeFile] } }
 */
export type McpGroupedToolSource = {
  /** Tool sets keyed by group name. */
  groups: Record<string, McpToolSource>;
};

/**
 * What `ai.mcp.serve` exposes as tools — one tool set, or several named
 * groups. Every exposed tool name must be unique: a duplicate throws an
 * {@link import("../errors").McpServeError} (`type: "collision"`) when
 * `serve()` is called.
 */
export type McpServeSource = McpToolSource | McpGroupedToolSource;

/**
 * Normalised metadata of an inbound HTTP request, handed to a custom
 * {@link McpHttpAuth.authorize} hook. Tools receive the same headers on
 * `ctx.request` (see `ToolRequestContext` in `@warlock.js/ai`).
 */
export type McpHttpRequestInfo = ToolRequestContext & {
  /** The HTTP method, upper-case (`"POST"`, `"GET"`, …). */
  method: string;
  /** The request path, without the query string. */
  path: string;
};

/**
 * Authentication for an HTTP-served MCP endpoint. At least one of
 * `bearer` / `authorize` is required; when both are set, a request must
 * pass both. A request that fails gets HTTP 401 before its body is read.
 */
export type McpHttpAuth = {
  /**
   * Accepted bearer token(s), matched against
   * `Authorization: Bearer <token>`. Compared in constant time over
   * SHA-256 digests, so neither the token's content nor its length leaks
   * through response timing. Several tokens allow rotation without
   * downtime. Empty strings are rejected when the server starts.
   */
  bearer?: string | readonly string[];
  /**
   * Custom check run for every request (after `bearer`, when both are
   * set). Return `true` to allow. A hook that throws or rejects denies the
   * request (fails closed).
   */
  authorize?: (request: McpHttpRequestInfo) => boolean | Promise<boolean>;
};

/**
 * Serve over the MCP Streamable HTTP transport.
 *
 * Binds `127.0.0.1` by default. Binding any non-loopback address
 * requires `auth`; `start()` throws otherwise.
 */
export type McpHttpServeTransport = {
  /** Streamable HTTP transport. */
  type: "http";
  /**
   * Interface to bind. Loopback (`127.0.0.1`, `::1`, `localhost`) needs
   * no auth; anything else (`0.0.0.0`, a LAN address) requires `auth`.
   *
   * @default "127.0.0.1"
   */
  host?: string;
  /**
   * Port to bind. `0` picks a free ephemeral port; read the result from
   * the `url` that `start()` resolves.
   *
   * @default 0
   */
  port?: number;
  /**
   * The single MCP endpoint path. Other paths answer 404.
   *
   * @default "/mcp"
   */
  path?: string;
  /** Bearer token(s) and/or a custom authorize hook. Required off loopback. */
  auth?: McpHttpAuth;
  /**
   * Extra browser origins allowed to call the endpoint, as full origins
   * (`"https://app.example.com"`). Loopback origins (`http://localhost:*`,
   * `http://127.0.0.1:*`, `http://[::1]:*`) are always allowed; any other
   * `Origin` header is refused with 403, which blocks DNS-rebinding
   * attacks from web pages. Requests without an `Origin` header (non-browser
   * clients) are unaffected.
   */
  allowedOrigins?: readonly string[];
  /**
   * Extra `Host` header names accepted while bound to loopback (where only
   * `localhost`, `127.0.0.1` and `[::1]` are accepted by default — the
   * second DNS-rebinding guard). When bound off loopback, setting this
   * restricts `Host` to exactly these names.
   */
  allowedHosts?: readonly string[];
  /**
   * Maximum accepted request body, in bytes. Larger bodies get 413.
   *
   * @default 1_048_576 (1 MiB)
   */
  maxBodyBytes?: number;
  /**
   * How long `close()` waits for in-flight requests to finish before it
   * aborts their `ctx.signal` and destroys the remaining connections.
   *
   * @default 5_000
   */
  drainTimeoutMs?: number;
};

/**
 * Where an `ai.mcp.serve` server listens. Discriminated by `type`.
 *
 * - `"stdio"` — serve JSON-RPC over this process's stdin/stdout.
 * - `"http"` — serve MCP Streamable HTTP (see {@link McpHttpServeTransport}).
 */
export type McpServeTransport = { type: "stdio" } | McpHttpServeTransport;

/**
 * Per-call context handed to resource readers and prompt builders (tools
 * receive the same data on their `ToolContext`).
 */
export type McpServeCallContext = {
  /** The inbound HTTP request; absent over stdio. */
  request?: McpHttpRequestInfo;
  /** Aborted when an HTTP server's `close()` gives up draining. */
  signal?: AbortSignal;
};

/**
 * A static MCP resource served by `resources/list` + `resources/read`.
 */
export type McpServeResource = {
  /** Unique resource URI, e.g. `"docs://handbook"`. */
  uri: string;
  /** Resource name. */
  name: string;
  /** Optional display title. */
  title?: string;
  /** Optional description. */
  description?: string;
  /** Optional MIME type, echoed on the read result. */
  mimeType?: string;
  /**
   * Produce the resource's contents. A string is sent as `text`; bytes
   * are sent base64-encoded as `blob`.
   */
  read(context: McpServeCallContext): string | Uint8Array | Promise<string | Uint8Array>;
};

/** One declared argument of an {@link McpServePrompt}. */
export type McpPromptArgument = {
  /** Argument name. */
  name: string;
  /** Optional description shown to the user. */
  description?: string;
  /** When `true`, `prompts/get` without it answers an invalid-params error. */
  required?: boolean;
};

/** One message of a prompt returned by `prompts/get`. */
export type McpPromptMessage = {
  /** Who speaks the message. */
  role: "user" | "assistant";
  /** The content block (`{ type: "text", text }` for plain text). */
  content: McpContentBlock;
};

/**
 * A prompt template served by `prompts/list` + `prompts/get`.
 */
export type McpServePrompt = {
  /** Unique prompt name. */
  name: string;
  /** Optional display title. */
  title?: string;
  /** Optional description. */
  description?: string;
  /** Declared arguments. */
  arguments?: McpPromptArgument[];
  /**
   * Build the prompt. A string becomes one `user` text message.
   *
   * @param args - The client's arguments (string values per the MCP spec).
   */
  get(
    args: Record<string, string>,
    context: McpServeCallContext,
  ): string | McpPromptMessage[] | Promise<string | McpPromptMessage[]>;
};

/**
 * Options for `ai.mcp.serve(source, options)` (Direction B: local
 * primitive → MCP server other clients can consume).
 */
export interface McpServeOptions {
  /** Server name advertised in the `initialize` response. */
  name: string;
  /**
   * Server version advertised in `initialize`.
   *
   * @default the package version
   */
  version?: string;
  /**
   * Where to listen.
   *
   * @default { type: "stdio" }
   */
  transport?: McpServeTransport;
  /**
   * JSON-Schema dialect emitted for each tool's `inputSchema`. Defaults
   * to a neutral MCP draft rather than `extractJsonSchema`'s own
   * `"openai-strict"` default.
   *
   * @default "draft-2020-12"
   */
  schemaTarget?: JsonSchemaTarget;
  /**
   * Opt in to native MCP result detection for objects containing `content`,
   * `isError`, `structuredContent` or `_meta`. Other values still become text.
   * Override per tool with `meta.mcpResults: "native" | "text"`.
   * Explicit `mcpResult()` values always pass through after validation.
   *
   * @default "text"
   */
  results?: "text" | "native";
  /**
   * Prefix each tool of a grouped source (`{ groups: { … } }`) with its
   * group name. `true` exposes `<group>_<tool>`; a function builds the
   * exposed name itself. Only valid with a grouped source.
   *
   * @default false — names are exposed as-is and duplicates throw
   */
  prefixToolNames?: boolean | ((group: string, toolName: string) => string);
  /** Static resources to serve. Omit to leave the `resources` capability off. */
  resources?: McpServeResource[];
  /** Prompt templates to serve. Omit to leave the `prompts` capability off. */
  prompts?: McpServePrompt[];
}

/**
 * What a started server resolves with. Over HTTP, `url` is the full
 * endpoint (`http://127.0.0.1:53211/mcp`); over stdio it is absent.
 */
export interface McpServeHandle {
  /** The endpoint URL (HTTP only). */
  url?: string;
  /**
   * Stop serving. Over HTTP: stop accepting connections, let in-flight
   * requests finish (up to `drainTimeoutMs`), then free the port.
   * Idempotent.
   */
  close(): Promise<void>;
}

/** The handle of an HTTP-served MCP endpoint — `url` is always set. */
export interface McpHttpServeHandle extends McpServeHandle {
  /** The endpoint URL, e.g. `http://127.0.0.1:53211/mcp`. */
  url: string;
}

/**
 * A `ai.mcp.serve` server. Nothing listens until `start()`.
 */
export interface McpServer<THandle extends McpServeHandle = McpServeHandle> {
  /**
   * Begin serving. Over HTTP, resolves once the port is bound with
   * `{ url, close }`. Calling it again while running resolves the same
   * handle.
   */
  start(): Promise<THandle>;
  /** Stop serving and release the transport (same as `handle.close()`). */
  stop(): Promise<void>;
}
