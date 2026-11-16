import { createJsonRpcClient, type JsonRpcClientHandle } from "@warlock.js/ai-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { command } from "../../commands/cli-command";
import { warlockConfigManager } from "../../warlock-config/warlock-config.manager";
import { fakeMcpContext } from "./__fixtures__/fake-mcp-context";
import { configuredMcpTools } from "./configured-mcp-tools";
import {
  mcpToolsFromConfig,
  mcpToolsOf,
  withMcpTools,
  type WarlockMcpToolSource,
} from "./mcp-tool-registry";
import type { WarlockMcpTool } from "./mcp-tools";
import { resolveWarlockMcpTools } from "./resolve-mcp-tools";
import { startWarlockMcpServer, type WarlockMcpServerHandle } from "./start-mcp-server";
import { inputSchema } from "./tool-input";

/**
 * Tools registered by packages and the app: served next to the built-in ones
 * through the real `@warlock.js/ai-tools` server, checked like them, and
 * gated by `--allow-writes`.
 */

type ToolsList = { tools: { name: string; description: string }[] };
type CallResult = { content: { type: string; text: string }[]; isError: boolean };

const servers: WarlockMcpServerHandle[] = [];
const clients: JsonRpcClientHandle[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0)) await server.close();
});

/** A read-only tool that echoes its input and the inspected app name. */
function echoTool(name = "acme_echo"): WarlockMcpTool {
  return {
    name,
    description: "Echo the text back with the app name. Read-only.",
    input: inputSchema({ text: { type: "string", description: "What to echo." } }, ["text"]),
    writes: false,
    run: async (input) => ({ echo: input.text }),
  };
}

/** A tool that writes, recording each run. */
function writeTool(runs: unknown[]): WarlockMcpTool {
  return {
    name: "acme_write",
    description: "Write a note into the project.",
    input: inputSchema({ note: { type: "string", description: "The note." } }, ["note"]),
    writes: true,
    run: async (input) => {
      runs.push(input);
      return { written: true };
    },
  };
}

async function connect(tools: readonly WarlockMcpToolSource[], allowWrites = false) {
  const { context } = fakeMcpContext({ allowWrites });
  const server = await startWarlockMcpServer({
    context,
    tools,
    transport: { type: "http", port: 0 },
  });

  servers.push(server);

  const client = createJsonRpcClient({ type: "http", url: server.url ?? "" });

  clients.push(client);

  await client.call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "spec", version: "1" },
  });
  await client.notify("notifications/initialized");

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.call<CallResult>("tools/call", { name, arguments: args });
    const text = result.content[0]?.text ?? "";

    return { isError: result.isError, text, json: (): unknown => JSON.parse(text) };
  };

  return { server, client, call };
}

describe("registered MCP tools over the server", () => {
  it("serves a registered tool after the built-in ones and validates its arguments", async () => {
    const { server, client, call } = await connect([
      (context) => ({
        ...echoTool(),
        run: async (input) => ({
          echo: input.text,
          app: (await context.inspect(["routes"])).app.name,
        }),
      }),
    ]);

    expect(server.tools.at(-1)).toBe("acme_echo");
    expect(server.tools).toContain("inspect_app");

    const { tools } = await client.call<ToolsList>("tools/list");

    expect(tools.map((tool) => tool.name)).toContain("acme_echo");

    const echoed = await call("acme_echo", { text: "hello" });

    expect(echoed.isError).toBe(false);
    expect(echoed.json()).toEqual({ echo: "hello", app: "fixture-app" });

    const invalid = await call("acme_echo", { text: 3, extra: true });

    expect(invalid.isError).toBe(true);
    expect(invalid.text).toContain('"text" must be a string');
    expect(invalid.text).toContain('unknown argument "extra"');
  });

  it("refuses every call of a writing tool without --allow-writes (WL7005)", async () => {
    const runs: unknown[] = [];
    const { client, call } = await connect([writeTool(runs)]);

    const { tools } = await client.call<ToolsList>("tools/list");

    expect(tools.find((tool) => tool.name === "acme_write")?.description).toContain(
      "--allow-writes",
    );

    const refused = await call("acme_write", { note: "x" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("WL7005");
    expect(runs).toEqual([]);
  });

  it("runs a writing tool when the server allows writes", async () => {
    const runs: unknown[] = [];
    const { call } = await connect([writeTool(runs)], true);

    const written = await call("acme_write", { note: "x" });

    expect(written.isError).toBe(false);
    expect(written.json()).toEqual({ written: true });
    expect(runs).toEqual([{ note: "x" }]);
  });

  it("refuses to start when a registered tool takes a built-in name", async () => {
    const { context } = fakeMcpContext();

    await expect(
      startWarlockMcpServer({
        context,
        tools: [echoTool("inspect_routes")],
        transport: { type: "http", port: 0 },
      }),
    ).rejects.toThrow('Registered MCP tool "inspect_routes" has the name of a built-in');
  });
});

describe("resolveWarlockMcpTools", () => {
  const { context } = fakeMcpContext();

  it("refuses two registered tools with the same name", () => {
    expect(() => resolveWarlockMcpTools(context, [echoTool(), () => [echoTool()]])).toThrow(
      'Two registered MCP tools are named "acme_echo"',
    );
  });

  it("checks names and input schemas like the built-in tools", () => {
    expect(() => resolveWarlockMcpTools(context, [echoTool("acme.echo")])).toThrow(
      'name "acme.echo" is invalid',
    );
    expect(() =>
      resolveWarlockMcpTools(context, [
        { ...echoTool(), input: { ...inputSchema({}), required: ["text"] } },
      ]),
    ).toThrow('required argument "text" is not in properties');
    expect(() =>
      resolveWarlockMcpTools(context, [
        {
          ...echoTool(),
          input: inputSchema({ text: { type: "string", description: "" } }),
        },
      ]),
    ).toThrow('input property "text" needs a description');
  });

  it("returns the built-in tools alone when nothing is registered", () => {
    const names = resolveWarlockMcpTools(context).map((tool) => tool.name);

    expect(names).toContain("inspect_app");
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("registration from warlock.config.ts", () => {
  it("collects the tools attached to cli.commands, then mcp.tools", () => {
    const fromApp = echoTool("app_echo");
    const scry = withMcpTools(command({ name: "acme.scry", action: () => undefined }), [
      echoTool("acme_scry"),
    ]);
    const plain = command({ name: "acme.plain", action: () => undefined });

    withMcpTools(scry, [echoTool("acme_more")]);

    expect(mcpToolsOf(plain)).toEqual([]);
    expect(
      mcpToolsFromConfig({ cli: { commands: [plain, scry] }, mcp: { tools: [fromApp] } }).map(
        (tool) => (typeof tool === "function" ? "factory" : tool.name),
      ),
    ).toEqual(["acme_scry", "acme_more", "app_echo"]);
    expect(mcpToolsFromConfig(undefined)).toEqual([]);
  });

  it("reads the tools of the loaded config (the mcp command and warlock dev --mcp)", async () => {
    const scry = withMcpTools(command({ name: "acme.scry", action: () => undefined }), [
      echoTool("acme_scry"),
    ]);

    vi.spyOn(warlockConfigManager, "isLoaded", "get").mockReturnValue(true);
    vi.spyOn(warlockConfigManager, "load").mockResolvedValue({ cli: { commands: [scry] } });

    const tools = await configuredMcpTools();
    const { call } = await connect(tools);

    expect((await call("acme_scry", { text: "hi" })).json()).toEqual({ echo: "hi" });
  });

  it("serves no extra tools when no config is loaded", async () => {
    vi.spyOn(warlockConfigManager, "isLoaded", "get").mockReturnValue(false);

    await expect(configuredMcpTools()).resolves.toEqual([]);
  });
});
