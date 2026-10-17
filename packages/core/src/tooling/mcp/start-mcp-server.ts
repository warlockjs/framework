import { WarlockError } from "../../errors/warlock-error";
import {
  type AiToolsServeModule,
  loadAiToolsServe,
  type ServeToolContract,
  type ServeTransportOptions,
} from "./load-ai-tools";
import {
  createWarlockMcpTools,
  describeToolError,
  type WarlockMcpContext,
  type WarlockMcpTool,
} from "./mcp-tools";
import { toStandardSchema, validateToolInput } from "./tool-input";

/** Where the server listens. */
export type WarlockMcpTransport =
  | { type: "stdio" }
  | {
      type: "http";
      /** Default `127.0.0.1`. Any other host requires `token`. */
      host?: string;
      /** Default `0` (a free port; read it from the returned `url`). */
      port?: number;
      /** Default `/mcp`. */
      path?: string;
      /** Bearer token clients must send (`Authorization: Bearer <token>`). */
      token?: string;
    };

/** Options of {@link startWarlockMcpServer}. */
export type StartWarlockMcpServerOptions = {
  context: WarlockMcpContext;
  /** Default `{ type: "stdio" }`. */
  transport?: WarlockMcpTransport;
  /** Advertised in `initialize`. Default `"warlock"`. */
  name?: string;
  version?: string;
  /** How `@warlock.js/ai-tools` is loaded (tests inject it). */
  loadServe?: () => Promise<AiToolsServeModule>;
};

/** A running server. */
export type WarlockMcpServerHandle = {
  /** The endpoint (HTTP only), e.g. `http://127.0.0.1:53211/mcp`. */
  url?: string;
  /** The exposed tool names. */
  tools: string[];
  close(): Promise<void>;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/** Whether a bind host is loopback-only. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

/** Resolve the transport, refusing a non-loopback bind without a token (`WL7004`). */
export function resolveMcpTransport(
  transport: WarlockMcpTransport = { type: "stdio" },
): ServeTransportOptions {
  if (transport.type === "stdio") return { type: "stdio" };

  const host = transport.host ?? "127.0.0.1";
  const token = transport.token?.trim();

  if (!isLoopbackHost(host) && !token) {
    throw new WarlockError(
      "WL7004",
      `warlock mcp --http refuses to listen on ${host} without a token: anything that can reach that address could call the tools. Pass --token or set WARLOCK_MCP_TOKEN.`,
    );
  }

  return {
    type: "http",
    host,
    port: transport.port ?? 0,
    path: transport.path ?? "/mcp",
    ...(token ? { auth: { bearer: token } } : {}),
  };
}

const EMPTY_USAGE = { input: 0, output: 0, total: 0 };

function report(name: string, status: "completed" | "failed", startedAt: Date) {
  const endedAt = new Date();

  return {
    runId: `warlock-mcp-${startedAt.getTime()}`,
    name,
    type: "tool",
    status,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    duration: endedAt.getTime() - startedAt.getTime(),
    usage: EMPTY_USAGE,
    children: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turn a Warlock tool into the contract `ai.mcp.serve` runs: arguments are
 * prechecked (a write on a read-only server), validated against the advertised
 * schema, then run; a failure becomes an `isError` result carrying the WL code
 * and its fix, never a crashed server.
 */
export function toServeContract(tool: WarlockMcpTool): ServeToolContract {
  return {
    name: tool.name,
    description: tool.description,
    input: toStandardSchema(tool.input),
    execute: (input) => tool.run(input),
    async invoke(raw) {
      const startedAt = new Date();
      const input = isRecord(raw) ? raw : {};
      const refusal = tool.precheck?.(input) ?? null;
      const issues = refusal ? [refusal] : validateToolInput(tool.input, raw);

      if (issues.length > 0) {
        return {
          error: new Error(`Invalid arguments for ${tool.name}: ${issues.join("; ")}`),
          usage: EMPTY_USAGE,
          report: report(tool.name, "failed", startedAt),
        };
      }

      try {
        const data = await tool.run(input);

        return { data, usage: EMPTY_USAGE, report: report(tool.name, "completed", startedAt) };
      } catch (error) {
        return {
          error: new Error(describeToolError(error)),
          usage: EMPTY_USAGE,
          report: report(tool.name, "failed", startedAt),
        };
      }
    },
  };
}

/**
 * Serve the app's tools over MCP — stdio by default, or Streamable HTTP
 * through `@warlock.js/ai-tools` (loopback by default; a token is required off
 * loopback). Read-only unless `context.allowWrites`.
 *
 * @example
 * const server = await startWarlockMcpServer({
 *   context,
 *   transport: { type: "http", token: process.env.WARLOCK_MCP_TOKEN },
 * });
 * console.error(`MCP at ${server.url}`);
 * await server.close();
 */
export async function startWarlockMcpServer(
  options: StartWarlockMcpServerOptions,
): Promise<WarlockMcpServerHandle> {
  const transport = resolveMcpTransport(options.transport);
  const module = await (options.loadServe ?? (() => loadAiToolsServe(options.context.cwd)))();
  const tools = createWarlockMcpTools(options.context);
  const server = module.serve(tools.map(toServeContract), {
    name: options.name ?? "warlock",
    version: options.version,
    transport,
  });
  const handle = await server.start();

  return {
    ...(handle.url ? { url: handle.url } : {}),
    tools: tools.map((tool) => tool.name),
    close: async () => {
      await handle.close();
      await server.stop();
    },
  };
}
