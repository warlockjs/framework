import { createInterface, type Interface } from "node:readline";
import { extractJsonSchema, type ToolContext, type ToolContract } from "@warlock.js/ai";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpGroupedToolSource,
  McpHttpServeHandle,
  McpHttpServeTransport,
  McpPromptMessage,
  McpServeCallContext,
  McpServeHandle,
  McpServeOptions,
  McpServePrompt,
  McpServeResource,
  McpServeSource,
  McpServer,
  McpToolCallResult,
  McpToolDescriptor,
  McpToolSource,
} from "../contracts";
import { McpServeError, McpTransportError } from "../errors";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "./protocol";
import { startHttpServer } from "./serve-http";

/** JSON-RPC version literal every outbound message carries. */
const JSONRPC_VERSION = "2.0";

/** Default JSON-Schema dialect emitted for each tool's `inputSchema`. */
const DEFAULT_SCHEMA_TARGET = "draft-2020-12";

/** Default advertised server version when the caller omits one. */
const DEFAULT_VERSION = "4.4.0";

/** JSON-RPC standard error codes we emit. */
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;

/** MCP's "resource not found" error code (server/resources, error handling). */
const MCP_RESOURCE_NOT_FOUND = -32002;

/** One tool as exposed on the wire: its public name plus the contract behind it. */
type ExposedTool = {
  /** The name clients see in `tools/list` and send in `tools/call`. */
  name: string;
  /** The contract that runs. */
  contract: ToolContract;
};

/**
 * A JSON-RPC failure raised inside a method handler, carrying the exact
 * code to answer with (unknown resource, missing prompt argument, …).
 */
class RpcFailure extends Error {
  public readonly code: number;

  public readonly data: unknown;

  public constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/** Enumerate one tool set into a flat contract array. */
function toolsOf(source: McpToolSource): ToolContract[] {
  return Array.isArray(source) ? source : source.tools();
}

/** Narrow a serve source to its grouped shape. */
function isGroupedSource(source: McpServeSource): source is McpGroupedToolSource {
  return !Array.isArray(source) && "groups" in source;
}

/**
 * Resolve the serve source into the exposed tool list, applying
 * `prefixToolNames` and refusing duplicate names. Throws
 * {@link McpServeError} — `"config"` for `prefixToolNames` on an ungrouped
 * source, `"collision"` when two tools would share a name.
 */
function resolveTools(source: McpServeSource, options: McpServeOptions): ExposedTool[] {
  const prefix = options.prefixToolNames ?? false;
  const exposed: Array<ExposedTool & { origin: string }> = [];

  if (isGroupedSource(source)) {
    for (const [group, groupSource] of Object.entries(source.groups)) {
      for (const contract of toolsOf(groupSource)) {
        let name = contract.name;

        if (prefix === true) {
          name = `${group}_${contract.name}`;
        } else if (typeof prefix === "function") {
          name = prefix(group, contract.name);
        }

        exposed.push({ name, contract, origin: `group "${group}"` });
      }
    }
  } else {
    if (prefix !== false) {
      throw new McpServeError(
        "prefixToolNames needs a grouped source: serve({ groups: { name: tools } }, …).",
        { type: "config" },
      );
    }

    for (const contract of toolsOf(source)) {
      exposed.push({ name: contract.name, contract, origin: "the source" });
    }
  }

  const seen = new Map<string, string>();

  for (const tool of exposed) {
    const previous = seen.get(tool.name);

    if (previous !== undefined) {
      throw new McpServeError(
        `MCP tool name "${tool.name}" is exposed twice (from ${previous} and ${tool.origin}). ` +
          "Rename one tool, or serve a grouped source with prefixToolNames.",
        { type: "collision", context: { name: tool.name } },
      );
    }

    seen.set(tool.name, tool.origin);
  }

  return exposed.map(({ name, contract }) => ({ name, contract }));
}

/** Throw a collision error when two entries share the same key. */
function assertUnique<T>(
  entries: readonly T[] | undefined,
  key: (entry: T) => string,
  label: string,
): void {
  const seen = new Set<string>();

  for (const entry of entries ?? []) {
    const value = key(entry);

    if (seen.has(value)) {
      throw new McpServeError(`MCP ${label} "${value}" is declared twice.`, {
        type: "collision",
        context: { [label]: value },
      });
    }

    seen.add(value);
  }
}

/**
 * The pure protocol core of `serve` — maps one JSON-RPC request to its
 * response, with no I/O. Both the stdio and HTTP serve-transports pump
 * their inbound requests through this, and specs can drive it directly.
 *
 * Handles `initialize`, `ping`, `tools/list`, `tools/call`, and — when
 * configured — `resources/list`, `resources/templates/list`,
 * `resources/read`, `prompts/list` and `prompts/get`. Any other method
 * answers with a JSON-RPC `method not found` error.
 *
 * Constructed via {@link createServeHandler}.
 */
class McpServeHandler {
  /** The tools this server exposes (snapshotted at construction). */
  private readonly tools: ExposedTool[];

  /** Fast lookup by exposed tool name for `tools/call` dispatch. */
  private readonly byName: Map<string, ToolContract>;

  /** Resources by URI, or `undefined` when the capability is off. */
  private readonly resources: Map<string, McpServeResource> | undefined;

  /** Prompts by name, or `undefined` when the capability is off. */
  private readonly prompts: Map<string, McpServePrompt> | undefined;

  /** Construction-time serve options (name / version / schema target). */
  private readonly options: McpServeOptions;

  public constructor(source: McpServeSource, options: McpServeOptions) {
    this.tools = resolveTools(source, options);
    this.byName = new Map(this.tools.map((tool) => [tool.name, tool.contract]));

    assertUnique(options.resources, (resource) => resource.uri, "resource");
    assertUnique(options.prompts, (prompt) => prompt.name, "prompt");

    this.resources = options.resources
      ? new Map(options.resources.map((resource) => [resource.uri, resource]))
      : undefined;
    this.prompts = options.prompts
      ? new Map(options.prompts.map((prompt) => [prompt.name, prompt]))
      : undefined;
    this.options = options;
  }

  /**
   * Dispatch one inbound JSON-RPC request to its handler and produce the
   * response. A handler that throws is mapped to a JSON-RPC error response
   * — the serve loop never crashes on a bad request.
   *
   * @param request - The JSON-RPC request.
   * @param context - Per-call context: the inbound HTTP request (headers
   *   reach tools as `ctx.request`) and an abort signal.
   */
  public async handle(
    request: JsonRpcRequest,
    context: McpServeCallContext = {},
  ): Promise<JsonRpcResponse> {
    try {
      return this.ok(request.id, await this.dispatch(request, context));
    } catch (cause) {
      if (cause instanceof RpcFailure) {
        return this.error(request.id, cause.code, cause.message, cause.data);
      }

      const message = cause instanceof Error ? cause.message : String(cause);

      return this.error(request.id, JSON_RPC_INVALID_PARAMS, message);
    }
  }

  /** Route a method to its result builder. */
  private async dispatch(request: JsonRpcRequest, context: McpServeCallContext): Promise<unknown> {
    switch (request.method) {
      case "initialize":
        return this.initializeResult(request.params);
      case "ping":
        return {};
      case "tools/list":
        return { tools: this.listTools() };
      case "tools/call":
        return this.callTool(request.params, context);
      default:
        break;
    }

    if (this.resources) {
      switch (request.method) {
        case "resources/list":
          return { resources: this.listResources(this.resources) };
        case "resources/templates/list":
          return { resourceTemplates: [] };
        case "resources/read":
          return this.readResource(this.resources, request.params, context);
        default:
          break;
      }
    }

    if (this.prompts) {
      switch (request.method) {
        case "prompts/list":
          return { prompts: this.listPrompts(this.prompts) };
        case "prompts/get":
          return this.getPrompt(this.prompts, request.params, context);
        default:
          break;
      }
    }

    throw new RpcFailure(
      JSON_RPC_METHOD_NOT_FOUND,
      `Method "${request.method}" is not supported by this MCP server.`,
    );
  }

  /**
   * Build the `initialize` result advertising name / version /
   * capabilities, negotiating the protocol version: the client's requested
   * version when supported, otherwise the newest this server speaks.
   */
  private initializeResult(params: unknown): Record<string, unknown> {
    const requested = readRecord(params).protocolVersion;
    const protocolVersion =
      typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;

    const capabilities: Record<string, unknown> = { tools: {} };

    if (this.resources) {
      capabilities.resources = {};
    }

    if (this.prompts) {
      capabilities.prompts = {};
    }

    return {
      protocolVersion,
      capabilities,
      serverInfo: {
        name: this.options.name,
        version: this.options.version ?? DEFAULT_VERSION,
      },
    };
  }

  /**
   * Build the `tools/list` payload: one {@link McpToolDescriptor} per
   * exposed tool, its `inputSchema` extracted via `extractJsonSchema` at
   * the configured dialect (default `draft-2020-12` — overriding
   * `extractJsonSchema`'s own `openai-strict` default to a neutral MCP draft).
   */
  private listTools(): McpToolDescriptor[] {
    const target = this.options.schemaTarget ?? DEFAULT_SCHEMA_TARGET;

    return this.tools.map(({ name, contract }) => {
      const inputSchema = extractJsonSchema(contract.input, { target }) ?? {
        type: "object",
        properties: {},
      };

      return {
        name,
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
   *
   * The contract receives a `ToolContext` carrying the abort signal and,
   * over HTTP, the inbound request's headers on `ctx.request`.
   */
  private async callTool(
    params: unknown,
    context: McpServeCallContext,
  ): Promise<McpToolCallResult> {
    const { name, args } = readCallParams(params);
    const contract = this.byName.get(name);

    if (!contract) {
      throw new McpTransportError(`Unknown tool "${name}".`, {
        type: "protocol",
        method: "tools/call",
      });
    }

    const toolContext: ToolContext = { artifacts: {} };

    if (context.signal) {
      toolContext.signal = context.signal;
    }

    if (context.request) {
      const { headers, remoteAddress } = context.request;

      toolContext.request = remoteAddress === undefined ? { headers } : { headers, remoteAddress };
    }

    const result = await contract.invoke(args, toolContext);

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

  /** Build the `resources/list` payload (metadata only, no contents). */
  private listResources(resources: Map<string, McpServeResource>): Record<string, unknown>[] {
    return [...resources.values()].map((resource) =>
      compact({
        uri: resource.uri,
        name: resource.name,
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
      }),
    );
  }

  /**
   * Answer `resources/read`: run the resource's `read()` and wrap the
   * result as one text or base64 blob content entry.
   */
  private async readResource(
    resources: Map<string, McpServeResource>,
    params: unknown,
    context: McpServeCallContext,
  ): Promise<Record<string, unknown>> {
    const uri = readRecord(params).uri;

    if (typeof uri !== "string") {
      throw new RpcFailure(JSON_RPC_INVALID_PARAMS, "resources/read requires a string `uri`.");
    }

    const resource = resources.get(uri);

    if (!resource) {
      throw new RpcFailure(MCP_RESOURCE_NOT_FOUND, "Resource not found", { uri });
    }

    const body = await resource.read(context);
    const entry =
      typeof body === "string"
        ? { uri, mimeType: resource.mimeType, text: body }
        : { uri, mimeType: resource.mimeType, blob: Buffer.from(body).toString("base64") };

    return { contents: [compact(entry)] };
  }

  /** Build the `prompts/list` payload. */
  private listPrompts(prompts: Map<string, McpServePrompt>): Record<string, unknown>[] {
    return [...prompts.values()].map((prompt) =>
      compact({
        name: prompt.name,
        title: prompt.title,
        description: prompt.description,
        arguments: prompt.arguments,
      }),
    );
  }

  /**
   * Answer `prompts/get`: validate the arguments (strings only; required
   * ones present) and build the messages. An unknown prompt or a missing
   * required argument answers invalid-params, per the MCP prompts spec.
   */
  private async getPrompt(
    prompts: Map<string, McpServePrompt>,
    params: unknown,
    context: McpServeCallContext,
  ): Promise<Record<string, unknown>> {
    const record = readRecord(params);
    const name = record.name;

    if (typeof name !== "string") {
      throw new RpcFailure(JSON_RPC_INVALID_PARAMS, "prompts/get requires a string `name`.");
    }

    const prompt = prompts.get(name);

    if (!prompt) {
      throw new RpcFailure(JSON_RPC_INVALID_PARAMS, `Unknown prompt "${name}".`);
    }

    const args: Record<string, string> = {};

    for (const [key, value] of Object.entries(readRecord(record.arguments))) {
      if (typeof value !== "string") {
        throw new RpcFailure(JSON_RPC_INVALID_PARAMS, `Prompt argument "${key}" must be a string.`);
      }

      args[key] = value;
    }

    for (const argument of prompt.arguments ?? []) {
      if (argument.required && args[argument.name] === undefined) {
        throw new RpcFailure(
          JSON_RPC_INVALID_PARAMS,
          `Prompt "${name}" requires the "${argument.name}" argument.`,
        );
      }
    }

    const built = await prompt.get(args, context);
    const messages: McpPromptMessage[] =
      typeof built === "string"
        ? [{ role: "user", content: { type: "text", text: built } }]
        : built;

    return compact({ description: prompt.description, messages });
  }

  /** Build a JSON-RPC success response. */
  private ok(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
    return { jsonrpc: JSONRPC_VERSION, id, result };
  }

  /** Build a JSON-RPC error response. */
  private error(
    id: JsonRpcRequest["id"],
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcResponse {
    const error = data === undefined ? { code, message } : { code, message, data };

    return { jsonrpc: JSONRPC_VERSION, id, error };
  }
}

/** Read an unknown value as a plain record (non-objects read as empty). */
function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

/** Drop `undefined` members so optional wire fields are omitted, not `null`. */
function compact(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, member] of Object.entries(value)) {
    if (member !== undefined) {
      result[key] = member;
    }
  }

  return result;
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
 * The pure protocol handler: one JSON-RPC request in, one response out.
 */
export interface McpServeRequestHandler {
  /**
   * Map one request to its response.
   *
   * @param request - The JSON-RPC request.
   * @param context - Optional per-call context (inbound HTTP request, abort signal).
   */
  handle(request: JsonRpcRequest, context?: McpServeCallContext): Promise<JsonRpcResponse>;
}

/**
 * Build the pure protocol handler for a serve source. Exposed (alongside
 * {@link serve}) so callers and tests can drive the MCP protocol without an
 * actual transport — feed it a JSON-RPC request, get the response.
 *
 * Throws {@link McpServeError} on duplicate tool names / resource URIs /
 * prompt names, or `prefixToolNames` on an ungrouped source.
 *
 * @param source - The tools to expose (one tool set or `{ groups }`).
 * @param options - Serve options (name / version / schema target / resources / prompts).
 * @returns An object whose `handle(request, context?)` maps a request to a response.
 */
export function createServeHandler(
  source: McpServeSource,
  options: McpServeOptions,
): McpServeRequestHandler {
  return new McpServeHandler(source, options);
}

/**
 * The internal {@link McpServer} — owns a {@link McpServeHandler} and a
 * transport pump. For `stdio` it reads newline-delimited JSON-RPC requests
 * from `process.stdin` and writes responses to `process.stdout`; for
 * `http` it binds a Streamable HTTP endpoint (see `./serve-http`).
 *
 * Constructed via {@link serve}; the class itself is internal.
 */
class McpServerImpl implements McpServer {
  /** The pure protocol handler. */
  private readonly handler: McpServeHandler;

  /** Serve options (transport selection lives here). */
  private readonly options: McpServeOptions;

  /** The running handle (stdio or http), while started or starting. */
  private running: Promise<McpServeHandle> | undefined;

  public constructor(source: McpServeSource, options: McpServeOptions) {
    this.handler = new McpServeHandler(source, options);
    this.options = options;
  }

  public start(): Promise<McpServeHandle> {
    if (!this.running) {
      const transport = this.options.transport ?? { type: "stdio" };
      const starting =
        transport.type === "http" ? this.startHttp(transport) : Promise.resolve(this.startStdio());

      // A failed start leaves the server startable again.
      this.running = starting.catch((error: unknown) => {
        this.running = undefined;
        throw error;
      });
    }

    return this.running;
  }

  /** Bind the HTTP endpoint; its `close()` also makes this server startable again. */
  private async startHttp(transport: McpHttpServeTransport): Promise<McpHttpServeHandle> {
    const http = await startHttpServer(transport, (request, context) =>
      this.handler.handle(request, context),
    );

    return {
      url: http.url,
      close: async () => {
        await http.close();
        this.running = undefined;
      },
    };
  }

  /** Wire the stdin line reader and answer each request on stdout. */
  private startStdio(): McpServeHandle {
    const reader: Interface = createInterface({ input: process.stdin });

    reader.on("line", (line) => {
      void this.onLine(line);
    });

    return {
      close: async () => {
        reader.close();
        this.running = undefined;
      },
    };
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
    const running = this.running;

    if (!running) {
      return;
    }

    let handle: McpServeHandle;

    try {
      handle = await running;
    } catch {
      // A start that failed has nothing to close.
      return;
    }

    await handle.close();
  }
}

/**
 * Expose a built agent / supervisor / orchestrator (or a raw
 * `ToolContract[]`, or several named groups) AS an MCP server (Direction B:
 * local primitive → MCP server other clients consume).
 *
 * Enumerates the tools once, here. Every exposed name must be unique — a
 * duplicate throws {@link McpServeError} (`type: "collision"`) right away;
 * serve `{ groups: { … } }` with `prefixToolNames: true` to namespace
 * same-named tools from different sets. `tools/list` answers with each
 * tool's `inputSchema` extracted via `extractJsonSchema` at the configured
 * `schemaTarget` (default `draft-2020-12`). `tools/call` routes to the
 * contract's `invoke()` and maps the never-throwing result — `data`
 * becomes a text content block, `error` an `isError: true` result.
 *
 * Transports: `stdio` (default) pumps `process.stdin` / `process.stdout`;
 * `http` binds an MCP Streamable HTTP endpoint on `127.0.0.1` by default,
 * with bearer / custom auth (required off loopback), `Origin` and `Host`
 * validation against DNS rebinding, a body-size cap, and a draining
 * `close()`. `start()` resolves `{ url, close }`.
 *
 * @param source - The tools to expose.
 * @param options - Server name, version, transport, schema dialect, resources, prompts.
 * @returns An {@link McpServer} with `start()` / `stop()`.
 *
 * @example
 * const { url, close } = await serve([calc, clock], {
 *   name: "session-tools",
 *   transport: { type: "http", auth: { bearer: sessionToken } },
 * }).start();
 */
export function serve(
  source: McpServeSource,
  options: McpServeOptions & { transport: McpHttpServeTransport },
): McpServer<McpHttpServeHandle>;
export function serve(source: McpServeSource, options: McpServeOptions): McpServer;
export function serve(source: McpServeSource, options: McpServeOptions): McpServer {
  return new McpServerImpl(source, options);
}
