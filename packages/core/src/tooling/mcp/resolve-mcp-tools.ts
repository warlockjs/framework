import type { WarlockMcpToolSource } from "./mcp-tool-registry";
import { createWarlockMcpTools, type WarlockMcpContext, type WarlockMcpTool } from "./mcp-tools";
import type { McpInputSchema } from "./tool-input";

/** What model APIs accept as a tool name. */
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/;

const PROPERTY_TYPES = new Set(["string", "integer", "boolean", "array"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What is wrong with an input schema (the subset `tool-input.ts` validates), or null. */
function schemaProblem(schema: McpInputSchema): string | null {
  if (!isRecord(schema) || schema.type !== "object" || !isRecord(schema.properties)) {
    return "input must be an object schema; build it with inputSchema({ … })";
  }

  if (schema.additionalProperties !== false) {
    return "input must set additionalProperties: false (inputSchema() does)";
  }

  for (const [name, property] of Object.entries(schema.properties)) {
    if (!isRecord(property) || !PROPERTY_TYPES.has(String(property.type))) {
      return `input property "${name}" must be a string, integer, boolean or array of strings`;
    }

    if (typeof property.description !== "string" || property.description.trim() === "") {
      return `input property "${name}" needs a description`;
    }

    if (property.type === "array" && (!isRecord(property.items) || property.items.type !== "string")) {
      return `input property "${name}" must be an array of strings (items: { type: "string" })`;
    }
  }

  for (const name of schema.required ?? []) {
    if (!(name in schema.properties)) return `required argument "${name}" is not in properties`;
  }

  return null;
}

/** Check one registered tool's shape; throws a message naming the tool and the fix. */
function assertValidTool(tool: WarlockMcpTool): void {
  const name: unknown = isRecord(tool) ? tool.name : undefined;

  if (typeof name !== "string" || !TOOL_NAME.test(name)) {
    throw new Error(
      `Registered MCP tool name ${JSON.stringify(name)} is invalid: use 1-128 letters, digits, "_" or "-" (no dots), e.g. "grimoire_scry".`,
    );
  }

  if (typeof tool.description !== "string" || tool.description.trim() === "") {
    throw new Error(`Registered MCP tool "${name}" needs a description.`);
  }

  if (typeof tool.run !== "function") {
    throw new Error(`Registered MCP tool "${name}" needs a run(input) function.`);
  }

  if (typeof tool.writes !== "boolean") {
    throw new Error(
      `Registered MCP tool "${name}" must say whether it writes project files (writes: true or false).`,
    );
  }

  const problem = schemaProblem(tool.input);

  if (problem) throw new Error(`Registered MCP tool "${name}": ${problem}.`);
}

function isToolList(
  value: WarlockMcpTool | readonly WarlockMcpTool[],
): value is readonly WarlockMcpTool[] {
  return Array.isArray(value);
}

/** Refuse every call of a writing tool on a read-only server, as the built-in tools do (WL7005). */
function gateWrites(tool: WarlockMcpTool, context: WarlockMcpContext): WarlockMcpTool {
  if (!tool.writes || context.allowWrites) return tool;

  return {
    ...tool,
    description: `${tool.description} This server is read-only (no --allow-writes): calls are refused.`,
    precheck: () =>
      `WL7005: this MCP server is read-only; restart it with --allow-writes to let ${tool.name} write project files.`,
  };
}

/**
 * The full tool list of a server: the built-in tools, then the registered
 * ones. A registered tool is checked like a built-in one (name, description,
 * input schema), refused when its name is already taken, and, when it
 * `writes`, refused on every call unless `context.allowWrites`.
 *
 * @throws Error naming the tool when a registered tool is invalid or its name is taken.
 */
export function resolveWarlockMcpTools(
  context: WarlockMcpContext,
  sources: readonly WarlockMcpToolSource[] = [],
): WarlockMcpTool[] {
  const builtIn = createWarlockMcpTools(context);
  const taken = new Map<string, "built-in" | "registered">(
    builtIn.map((tool) => [tool.name, "built-in"]),
  );
  const registered: WarlockMcpTool[] = [];

  for (const source of sources) {
    const built = typeof source === "function" ? source(context) : source;
    const tools = isToolList(built) ? built : [built];

    for (const tool of tools) {
      assertValidTool(tool);

      const owner = taken.get(tool.name);

      if (owner === "built-in") {
        throw new Error(
          `Registered MCP tool "${tool.name}" has the name of a built-in warlock mcp tool. Give it its own name, prefixed with the package (e.g. "grimoire_${tool.name}").`,
        );
      }

      if (owner === "registered") {
        throw new Error(
          `Two registered MCP tools are named "${tool.name}". Each tool name must be unique; rename one of them.`,
        );
      }

      taken.set(tool.name, "registered");
      registered.push(gateWrites(tool, context));
    }
  }

  return [...builtIn, ...registered];
}
