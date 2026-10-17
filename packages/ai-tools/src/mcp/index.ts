import type {
  McpClient,
  McpClientOptions,
  McpHttpServeHandle,
  McpHttpServeTransport,
  McpServeOptions,
  McpServeSource,
  McpServer,
  McpTransport,
} from "../contracts";
import { mcp as mcpClient } from "./client";
import { serve } from "./serve";

export { serve, createServeHandler } from "./serve";
export type { McpServeRequestHandler } from "./serve";
export { SUPPORTED_PROTOCOL_VERSIONS } from "./protocol";
export { jsonSchemaToStandard } from "./json-schema-to-standard";
export { createJsonRpcClient, createTransport } from "./transport";
export type { JsonRpcClientHandle } from "./transport";
export type { McpTransportClient } from "./transport.type";

/**
 * The callable `ai.mcp` surface — a factory that connects to an external
 * MCP server (Direction A) and also carries `.serve` to expose a local
 * primitive AS an MCP server (Direction B). Modeled as a function with an
 * attached `serve` property, mirroring how `ai.mcp(server).tools()` and
 * `ai.mcp.serve(source, options).start()` read in the design.
 */
export interface McpFactory {
  /**
   * Connect to an external MCP server and adapt its tools as agent tools.
   *
   * @param server - The transport config (`{ type: "stdio" }` / `{ type: "http" }`).
   * @param options - Prefix / filter / per-call timeout, and a `signal`
   *   that closes the client (and fails its calls) when it aborts.
   */
  (server: McpTransport, options?: McpClientOptions): McpClient;
  /**
   * Expose a built agent / supervisor / orchestrator (or a literal
   * `ToolContract[]`, or named `{ groups }`) AS an MCP server. Over
   * `{ type: "http" }`, `start()` resolves `{ url, close }`.
   *
   * @param source - The tools to expose.
   * @param options - Server name, version, transport, schema dialect, resources, prompts.
   */
  serve(
    source: McpServeSource,
    options: McpServeOptions & { transport: McpHttpServeTransport },
  ): McpServer<McpHttpServeHandle>;
  serve(source: McpServeSource, options: McpServeOptions): McpServer;
}

/**
 * The `ai.mcp` factory value: the client factory with `.serve` attached.
 * `Object.assign` keeps `mcp` callable (Direction A) while widening it with
 * the `serve` member (Direction B) — one object, both directions. The
 * `declare module "@warlock.js/ai"` augmentation and the runtime
 * registration (`ai.mcp = mcp`) live in `../register`, so this barrel is a
 * pure value/type module the registrar consumes.
 */
export const mcp: McpFactory = Object.assign(
  (server: McpTransport, options?: McpClientOptions): McpClient => mcpClient(server, options),
  { serve },
);
