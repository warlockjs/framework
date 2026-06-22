import { createInterface, type Interface } from "node:readline";
import { extractJsonSchema, type ToolContract } from "@warlock.js/ai";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpServeOptions,
  McpServeSource,
  McpServer,
  McpToolCallResult,
  McpToolDescriptor,
} from "../contracts";
import { McpTransportError } from "../errors";

/** JSON-RPC version literal every outbound message carries. */
const JSONRPC_VERSION = "2.0";

/** Default JSON-Schema dialect emitted for each tool's `inputSchema`. */
const DEFAULT_SCHEMA_TARGET = "draft-2020-12";

/** Default advertised server version when the caller omits one. */
const DEFAULT_VERSION = "4.4.0";

/** The MCP protocol version this server advertises in `initialize`. */
const PROTOCOL_VERSION = "2025-06-18";

/** JSON-RPC standard error codes we emit. */
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;

/**
 * Resolve the {@link McpServeSource} (either an object exposing `tools()`
 * or a literal `ToolContract[]`) into a flat contract array.
 */
function resolveTools(source: McpServeSource): ToolContract[] {
  if (Array.isArray(source)) {
    return source;
  }

  return source.tools();
}

/**
 * The pure protocol core of `serve` — maps one JSON-RPC request to its
 * response, with no I/O. Both the stdio and http serve-transports pump
 * their inbound requests through this, and specs can drive it directly.
 *
 * Handles exactly the MCP slice this package serves: `initialize`,
 * `tools/list`, and `tools/call`. Any other method answers with a
 * JSON-RPC `method not found` error.
 *
 * Constructed via {@link createServeHandler}.
 */
class McpServeHandler {
  /** The tools this server exposes (snapshotted at construction). */
  private readonly tools: ToolContract[];

  /** Fast lookup by tool name for `tools/call` dispatch. */
  private readonly byName: Map<string, ToolContract>;

  /** Construction-time serve options (name / version / schema target). */
  private readonly options: McpServeOptions;

  public constructor(source: McpServeSource, options: McpServeOptions) {
    this.tools = resolveTools(source);
    this.byName = new Map(this.tools.map((contract) => [contract.name, contract]));
    this.options = options;
  }

  /**
   * Dispatch one inbound JSON-RPC request to its handler and produce the
   * response. A handler that throws is mapped to a JSON-RPC error response
   * — the serve loop never crashes on a bad request.
   */
  public async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      switch (request.method) {
        case "initialize":
          return this.ok(request.id, this.initializeResult());
        case "tools/list":
          return this.ok(request.id, { tools: this.listTools() });
        case "tools/call":
          return this.ok(request.id, await this.callTool(request.params));
        default:
          return this.error(
            request.id,
            JSON_RPC_METHOD_NOT_FOUND,
            `Method "${request.method}" is not supported by this MCP server.`,
          );
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);

      return this.error(request.id, JSON_RPC_INVALID_PARAMS, message);
    }
  }

  /** Build the `initialize` result advertising name / version / capabilities. */
  private initializeResult(): Record<string, unknown> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: {
        name: this.options.name,
        version: this.options.version ?? DEFAULT_VERSION,
      },
    };
  }

  /**
   * Build the `tools/list` payload: one {@link McpToolDescriptor} per
   * contract, its `inputSchema` extracted via `extractJsonSchema` at the
   * configured dialect (default `draft-2020-12` — overriding
   * `extractJsonSchema`'s own `openai-strict` default to a neutral MCP draft).
   */
  private listTools(): McpToolDescriptor[] {
    const target = this.options.schemaTarget ?? DEFAULT_SCHEMA_TARGET;

    return this.tools.map((contract) => {
      const inputSchema = extractJsonSchema(contract.input, { target }) ?? {
        type: "object",
        properties: {},
      };

      return {
        name: contract.name,
        description: contract.description,
        inputSchema,
      };
    });
  }

  /**
   * Route a `tools/call` to the named contract's `invoke()` and map the
   * never-throwing {@link import("@warlock.js/ai").ToolInvokeResult}: `data`
   * → a text content block, `error` → an `isError: true` result. An unknown
   * tool name throws (mapped to a JSON-RPC error by {@link handle}).
   */
  private async callTool(params: unknown): Promise<McpToolCallResult> {
    const { name, args } = readCallParams(params);
    const contract = this.byName.get(name);

    if (!contract) {
      throw new McpTransportError(`Unknown tool "${name}".`, {
        type: "protocol",
        method: "tools/call",
      });
    }

    const result = await contract.invoke(args);

    if (result.error) {
      return {
        content: [{ type: "text", text: result.error.message }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: serializeData(result.data) }],
      isError: false,
    };
  }

  /** Build a JSON-RPC success response. */
  private ok(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
    return { jsonrpc: JSONRPC_VERSION, id, result };
  }

  /** Build a JSON-RPC error response. */
  private error(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
    return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
  }
}

/**
 * Read and validate the `tools/call` params into `{ name, args }`. Throws
 * a typed {@link McpTransportError} when `name` is missing — mapped to a
 * JSON-RPC `invalid params` error by the handler.
 */
function readCallParams(params: unknown): { name: string; args: unknown } {
  if (typeof params !== "object" || params === null) {
    throw new McpTransportError("tools/call params must be an object.", {
      type: "protocol",
      method: "tools/call",
    });
  }

  const record = params as { name?: unknown; arguments?: unknown };

  if (typeof record.name !== "string") {
    throw new McpTransportError("tools/call requires a string `name`.", {
      type: "protocol",
      method: "tools/call",
    });
  }

  return { name: record.name, args: record.arguments ?? {} };
}

/**
 * Serialize a tool's `data` for an MCP text content block — a string is
 * passed verbatim, everything else is JSON-stringified so structured
 * output crosses the wire as text the consuming client can re-parse.
 */
function serializeData(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }

  if (data === undefined) {
    return "";
  }

  return JSON.stringify(data);
}

/**
 * Build the pure protocol handler for a serve source. Exposed (alongside
 * {@link serve}) so callers and tests can drive the MCP protocol without an
 * actual transport — feed it a JSON-RPC request, get the response.
 *
 * @param source - The tools to expose (an object with `tools()` or a literal array).
 * @param options - Serve options (name / version / schema target).
 * @returns An object whose `handle(request)` maps a request to a response.
 */
export function createServeHandler(
  source: McpServeSource,
  options: McpServeOptions,
): { handle(request: JsonRpcRequest): Promise<JsonRpcResponse> } {
  return new McpServeHandler(source, options);
}

/**
 * The internal {@link McpServer} — owns a {@link McpServeHandler} and a
 * transport pump. For `stdio` it reads newline-delimited JSON-RPC requests
 * from `process.stdin` and writes responses to `process.stdout`; the
 * `http` transport is accepted but listening is deferred to the host
 * (a serve-over-HTTP needs a server the caller owns).
 *
 * Constructed via {@link serve}; the class itself is internal.
 */
class McpServerImpl implements McpServer {
  /** The pure protocol handler. */
  private readonly handler: McpServeHandler;

  /** Serve options (transport selection lives here). */
  private readonly options: McpServeOptions;

  /** The stdin line reader while serving over stdio. */
  private reader: Interface | undefined;

  /** Flipped while the server is actively reading the transport. */
  private running = false;

  public constructor(source: McpServeSource, options: McpServeOptions) {
    this.handler = new McpServeHandler(source, options);
    this.options = options;
  }

  public async start(): Promise<void> {
    if (this.running) {
      return;
    }

    const transport = this.options.transport ?? { type: "stdio" };

    if (transport.type !== "stdio") {
      throw new McpTransportError(
        "serve() over http requires a host-provided server; only stdio is auto-pumped.",
        { type: "connect" },
      );
    }

    this.running = true;
    this.reader = createInterface({ input: process.stdin });

    this.reader.on("line", (line) => {
      void this.onLine(line);
    });
  }

  /**
   * Parse one stdin line as a JSON-RPC request, dispatch it through the
   * handler, and write the response as a single line to stdout. Non-JSON
   * lines and notifications (no `id`) are ignored.
   */
  private async onLine(line: string): Promise<void> {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    let request: JsonRpcRequest;

    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      return;
    }

    if (request.id === undefined || request.id === null) {
      // A notification (e.g. notifications/initialized) — nothing to answer.
      return;
    }

    const response = await this.handler.handle(request);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }

  public async stop(): Promise<void> {
    this.running = false;
    this.reader?.close();
    this.reader = undefined;
  }
}

/**
 * Expose a built agent / supervisor / orchestrator (or a raw
 * `ToolContract[]`) AS an MCP server (Direction B: local primitive → MCP
 * server other clients consume).
 *
 * Enumerates `source.tools()` (or the literal array) once at construction.
 * `tools/list` answers with each tool's `inputSchema` extracted via
 * `extractJsonSchema` at the configured `schemaTarget` (default
 * `draft-2020-12`). `tools/call` routes to the named contract's
 * `invoke()` and maps the never-throwing result — `data` becomes a text
 * content block, `error` becomes an `isError: true` result — so a failing
 * tool surfaces as a normal MCP tool error rather than crashing the server.
 *
 * The default transport is `stdio`, pumped over `process.stdin` /
 * `process.stdout`. Serving over HTTP is left to a host-owned server;
 * `start()` rejects an `http` transport (the protocol core is available
 * via {@link createServeHandler} for a caller's own HTTP wiring).
 *
 * @param source - The tools to expose.
 * @param options - Server name, version, transport, and schema dialect.
 * @returns An {@link McpServer} with `start()` / `stop()`.
 *
 * @example
 * serve(
 *   { tools: () => ws.allTools() },
 *   { name: "warlock-workspace", transport: { type: "stdio" } },
 * ).start();
 */
export function serve(source: McpServeSource, options: McpServeOptions): McpServer {
  return new McpServerImpl(source, options);
}
