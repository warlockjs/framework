import { tool, type ToolContract } from "@warlock.js/ai";
import type {
  McpClient,
  McpClientOptions,
  McpContentBlock,
  McpToolCallResult,
  McpToolDescriptor,
  McpTransport,
} from "../contracts";
import { McpTransportError } from "../errors";
import { jsonSchemaToStandard } from "./json-schema-to-standard";
import { createJsonRpcClient, type JsonRpcClientHandle } from "./transport";
import type { McpTransportClient } from "./transport.type";

/** Default per-call timeout for `tools/call`. */
const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/** The MCP protocol version this client advertises in `initialize`. */
const PROTOCOL_VERSION = "2025-06-18";

/** The `tools/list` response slice we read. */
interface ToolsListResult {
  tools?: McpToolDescriptor[];
}

/**
 * The internal {@link McpClient} implementation. Owns one JSON-RPC client
 * over a transport, runs the `initialize` handshake on first use, lists
 * the server's tools, and adapts each into a {@link ToolContract} whose
 * `execute` issues `tools/call`. The adapted contracts are cached after
 * the first `tools()` so repeat calls don't re-handshake.
 *
 * Constructed via {@link mcp}; the class itself is internal.
 */
class McpClientImpl implements McpClient {
  /** The JSON-RPC client over the transport. */
  private readonly rpc: JsonRpcClientHandle;

  /** Construction-time options (prefix / filter / timeout). */
  private readonly options: McpClientOptions;

  /** Resolved + cached adapted tools, set after the first `tools()`. */
  private cached: ToolContract[] | undefined;

  /** In-flight `tools()` so concurrent callers share one handshake. */
  private pending: Promise<ToolContract[]> | undefined;

  /** Flipped once the handshake completes so we only do it once. */
  private initialized = false;

  /** The in-flight / settled `close()`, so closing is idempotent. */
  private closing: Promise<void> | undefined;

  /** Closes the client when `options.signal` aborts. */
  private readonly onAbort = (): void => {
    void this.close().catch(() => undefined);
  };

  public constructor(source: McpTransport | McpTransportClient, options: McpClientOptions = {}) {
    this.rpc = createJsonRpcClient(source);
    this.options = options;

    const signal = options.signal;

    if (signal?.aborted) {
      this.onAbort();
    } else {
      signal?.addEventListener("abort", this.onAbort, { once: true });
    }
  }

  /**
   * Reject with a typed `"closed"` error once the client was closed or its
   * `signal` aborted, so no request is sent on a dead transport.
   */
  private assertOpen(method: string): void {
    if (this.closing || this.options.signal?.aborted) {
      throw new McpTransportError(`MCP client is closed; "${method}" was not sent.`, {
        type: "closed",
        method,
      });
    }
  }

  /**
   * Run the MCP `initialize` handshake exactly once, then send the
   * `notifications/initialized` notification the protocol requires before
   * any other request. Wraps a handshake failure as a typed
   * {@link McpTransportError} of type `"connect"`.
   */
  private async handshake(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.assertOpen("initialize");

    try {
      await this.rpc.call(
        "initialize",
        {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "@warlock.js/ai-tools", version: "4.4.0" },
        },
        { signal: this.options.signal },
      );

      await this.rpc.notify("notifications/initialized");
    } catch (cause) {
      if (cause instanceof McpTransportError) {
        throw cause;
      }

      const message = cause instanceof Error ? cause.message : String(cause);

      throw new McpTransportError(`MCP initialize handshake failed: ${message}`, {
        type: "connect",
        method: "initialize",
        cause,
      });
    }

    this.initialized = true;
  }

  public tools(): Promise<ToolContract[]> {
    if (this.cached) {
      return Promise.resolve(this.cached);
    }

    if (this.pending) {
      return this.pending;
    }

    this.pending = this.listAndAdapt()
      .then((tools) => {
        this.cached = tools;

        return tools;
      })
      .finally(() => {
        this.pending = undefined;
      });

    return this.pending;
  }

  /**
   * Handshake, `tools/list`, and adapt each descriptor into a
   * {@link ToolContract}, applying the `filter` and `namePrefix` options.
   */
  private async listAndAdapt(): Promise<ToolContract[]> {
    await this.handshake();

    this.assertOpen("tools/list");

    const result = await this.rpc.call<ToolsListResult>("tools/list", undefined, {
      signal: this.options.signal,
    });
    const descriptors = result.tools ?? [];

    const filter = this.options.filter;
    const selected = filter ? descriptors.filter((d) => filter(d.name)) : descriptors;

    return selected.map((descriptor) => this.adapt(descriptor));
  }

  /**
   * Adapt one remote tool descriptor into a {@link ToolContract}: build
   * the input schema from its JSON Schema via {@link jsonSchemaToStandard},
   * prefix the name, and route `execute` through a `tools/call` that
   * honors `ctx.signal`, unwraps the content blocks, and throws on an
   * `isError` result so `tool()` wraps it.
   */
  private adapt(descriptor: McpToolDescriptor): ToolContract {
    const prefixedName = `${this.options.namePrefix ?? ""}${descriptor.name}`;
    const remoteName = descriptor.name;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    const input = jsonSchemaToStandard(descriptor.inputSchema);

    return tool<unknown, unknown>({
      name: prefixedName,
      description: descriptor.description ?? `Invoke the remote MCP tool "${remoteName}".`,
      input,
      ...(this.options.lint !== undefined ? { lint: this.options.lint } : {}),
      execute: async (args, ctx) => {
        this.assertOpen("tools/call");

        const result = await this.rpc.call<McpToolCallResult>(
          "tools/call",
          { name: remoteName, arguments: args ?? {} },
          { signal: combineSignals(ctx?.signal, this.options.signal), timeoutMs },
        );

        // An `isError` result is a tool-level failure — throw it so the
        // surrounding `tool()` wraps it as a `ToolExecutionError` and the
        // agent reads it as `{ error }` data and self-corrects.
        if (result.isError) {
          throw new McpTransportError(
            `MCP tool "${remoteName}" returned an error: ${unwrapContent(result.content)}`,
            { type: "protocol", method: "tools/call" },
          );
        }

        return unwrapResult(result.content);
      },
    });
  }

  public close(): Promise<void> {
    this.options.signal?.removeEventListener("abort", this.onAbort);
    this.closing ??= this.rpc.close();

    return this.closing;
  }
}

/**
 * The signal a `tools/call` honors: the per-call `ctx.signal`, the
 * client-level `options.signal`, both (whichever aborts first), or none.
 */
function combineSignals(
  callSignal: AbortSignal | undefined,
  clientSignal: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!callSignal || !clientSignal) {
    return callSignal ?? clientSignal;
  }

  return AbortSignal.any([callSignal, clientSignal]);
}

/**
 * Flatten an MCP `tools/call` result's content blocks into the value a
 * tool returns. Text blocks are concatenated; a single block whose text is
 * valid JSON is parsed so structured tool output flows back as an object
 * rather than a string. Non-text blocks are preserved as `type`-tagged
 * objects (MCP's wire `type` is kept; any inbound `kind` is normalized to
 * `type`).
 */
function unwrapResult(content: McpContentBlock[] | undefined): unknown {
  const blocks = content ?? [];

  // The overwhelmingly common case: a single text block. Parse JSON when
  // it is one, so structured results come back typed; otherwise the string.
  if (blocks.length === 1 && blocks[0].type === "text") {
    const text = blocks[0].text ?? "";

    return tryParseJson(text);
  }

  // Multiple / mixed blocks: return a normalized array, each tagged by
  // `type` (never `kind`).
  return blocks.map((block) => normalizeBlock(block));
}

/**
 * Render content blocks to a short human string for error messages — the
 * concatenated text of every text block.
 */
function unwrapContent(content: McpContentBlock[] | undefined): string {
  return (content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join(" ")
    .trim();
}

/**
 * Normalize one content block onto our `type`-only shape: translate an
 * inbound `kind` discriminator to `type` (and strip `kind`) so the value a
 * tool returns never carries MCP's `kind` vocabulary.
 */
function normalizeBlock(block: McpContentBlock): Record<string, unknown> {
  const { kind, ...rest } = block as McpContentBlock & { kind?: string };
  const type = block.type ?? kind ?? "unknown";

  return { ...rest, type };
}

/**
 * Parse a string as JSON, returning the parsed value on success or the
 * original string when it is not JSON — so a plain-text tool result stays
 * a string while a JSON tool result becomes an object.
 */
function tryParseJson(text: string): unknown {
  const trimmed = text.trim();

  if (!trimmed) {
    return text;
  }

  const first = trimmed[0];

  // Only attempt a parse for plausibly-structured payloads, so a bare
  // sentence isn't mangled by a lenient parse.
  if (first !== "{" && first !== "[") {
    return text;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

/**
 * Connect to an external MCP server and adapt its tools as agent tools
 * (Direction A: server → local agent tools).
 *
 * Opens the transport lazily and exposes {@link McpClient.tools}, which on
 * first call runs the `initialize` handshake, lists the server's tools via
 * `tools/list`, and maps each into a {@link ToolContract}:
 * - **input schema** — the remote tool's JSON Schema is wrapped as a
 *   Standard Schema via {@link jsonSchemaToStandard} (Ajv-backed, an
 *   optional peer);
 * - **execute** — issues `tools/call` honoring `ctx.signal` and the
 *   configured `timeoutMs`, unwraps the result content, and throws on an
 *   `isError` result so the `tool()` wrapper surfaces it as `{ error }`;
 * - **name** — prefixed with `options.namePrefix` to avoid local
 *   collisions; only tools passing `options.filter` are adapted.
 *
 * The adapted contracts are cached after the first `tools()` call, so the
 * handshake + list happen exactly once. The returned contracts drop
 * straight into `ai.agent({ tools: [...] })`.
 *
 * @param server - The transport config (`{ type: "stdio" }` /
 *   `{ type: "http" }`). A pre-built transport client may be injected for
 *   testing.
 * @param options - Prefix / filter / per-call timeout, and a `signal` that
 *   closes the client when it aborts.
 * @returns An {@link McpClient} handle.
 *
 * @example
 * const github = mcp(
 *   { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
 *   { namePrefix: "github." },
 * );
 * const dev = ai.agent({ model, tools: [...(await github.tools())] });
 */
export function mcp(
  server: McpTransport | McpTransportClient,
  options?: McpClientOptions,
): McpClient {
  return new McpClientImpl(server, options);
}
