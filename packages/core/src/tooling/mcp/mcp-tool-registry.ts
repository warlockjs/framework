/**
 * Extra `warlock mcp` tools from packages and the app.
 *
 * Kept free of runtime imports: `warlock.config.ts` reaches the production
 * entry, so a package's `register…Commands()` that calls {@link withMcpTools}
 * must not pull the tooling (and the TypeScript compiler) in with it.
 */
import type { CLICommand } from "../../commands/cli-command";
import type { WarlockConfig } from "../../warlock-config/types";
import type { WarlockMcpContext, WarlockMcpTool } from "./mcp-tools";

/**
 * A tool to add to the MCP server: the tool itself, or a function that builds
 * one or more tools from the server's context (the project root, whether
 * writes are allowed, the app's inspect report).
 */
export type WarlockMcpToolSource =
  | WarlockMcpTool
  | ((context: WarlockMcpContext) => WarlockMcpTool | readonly WarlockMcpTool[]);

/**
 * Shared through the global symbol registry, so a command built against
 * another copy of `@warlock.js/core` still carries its tools.
 */
const MCP_TOOLS = Symbol.for("warlock.mcp.tools");

/**
 * Attach MCP tools to a CLI command. When the command is listed in
 * `cli.commands` of `warlock.config.ts`, `warlock mcp` and `warlock dev --mcp`
 * serve its tools next to the built-in ones. Returns the same command, so a
 * package's register function stays one expression. Calling it again adds
 * more tools.
 *
 * @example
 * export function registerReportCommands() {
 *   return withMcpTools(command({ name: "report", action: runReport }), [
 *     {
 *       name: "report_summary",
 *       description: "The latest report summary. Read-only.",
 *       input: inputSchema({}),
 *       writes: false,
 *       run: async () => readSummary(),
 *     },
 *   ]);
 * }
 */
export function withMcpTools<Command extends CLICommand>(
  command: Command,
  tools: readonly WarlockMcpToolSource[],
): Command {
  const attached = mcpToolsOf(command);

  Object.defineProperty(command, MCP_TOOLS, {
    value: [...attached, ...tools],
    enumerable: false,
    configurable: true,
  });

  return command;
}

/** The MCP tools {@link withMcpTools} attached to a command (empty when none). */
export function mcpToolsOf(command: unknown): WarlockMcpToolSource[] {
  if (typeof command !== "object" || command === null) return [];

  const tools: unknown = Reflect.get(command, MCP_TOOLS);

  return Array.isArray(tools) ? [...(tools as WarlockMcpToolSource[])] : [];
}

/**
 * Every extra MCP tool a Warlock config registers: the tools attached to its
 * `cli.commands`, in order, then `mcp.tools`.
 */
export function mcpToolsFromConfig(
  config: Pick<WarlockConfig, "cli" | "mcp"> | undefined,
): WarlockMcpToolSource[] {
  if (!config) return [];

  return [
    ...(config.cli?.commands ?? []).flatMap((command) => mcpToolsOf(command)),
    ...(config.mcp?.tools ?? []),
  ];
}
