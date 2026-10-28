import { pathToFileURL } from "node:url";
import { createJsonRpcClient, type JsonRpcClientHandle } from "@warlock.js/ai-tools";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WarlockError } from "../../errors/warlock-error";
import { fakeMcpContext } from "./__fixtures__/fake-mcp-context";
import { loadAiToolsServe } from "./load-ai-tools";
import {
  isLoopbackHost,
  resolveMcpTransport,
  startWarlockMcpServer,
  type WarlockMcpServerHandle,
} from "./start-mcp-server";

/**
 * Round trips through the real `@warlock.js/ai-tools` server and client:
 * Streamable HTTP on an ephemeral loopback port, and stdio against a child
 * process that serves the same fixture context.
 */

type ToolsList = {
  tools: { name: string; inputSchema: { properties?: Record<string, unknown> } }[];
};
type CallResult = { content: { type: string; text: string }[]; isError: boolean };

const here = __dirname;
const servers: WarlockMcpServerHandle[] = [];
const clients: JsonRpcClientHandle[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0)) await server.close();
});

async function handshake(client: JsonRpcClientHandle): Promise<Record<string, unknown>> {
  const result = await client.call<Record<string, unknown>>("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "spec", version: "1" },
  });

  await client.notify("notifications/initialized");

  return result;
}

async function callTool(
  client: JsonRpcClientHandle,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await client.call<CallResult>("tools/call", { name, arguments: args });
  const text = result.content[0]?.text ?? "";

  return { isError: result.isError, text, json: (): unknown => JSON.parse(text) };
}

async function startHttp(options: { allowWrites?: boolean; token?: string } = {}) {
  const { context, calls } = fakeMcpContext({ allowWrites: options.allowWrites });
  const server = await startWarlockMcpServer({
    context,
    transport: { type: "http", port: 0, ...(options.token ? { token: options.token } : {}) },
    version: "5.31.0",
  });

  servers.push(server);

  return { server, calls };
}

function httpClient(url: string, headers: Record<string, string> = {}): JsonRpcClientHandle {
  const client = createJsonRpcClient({ type: "http", url, headers });

  clients.push(client);

  return client;
}

describe("warlock mcp over Streamable HTTP", () => {
  it("binds loopback, lists the tools and answers inspect calls", async () => {
    const { server } = await startHttp();

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    const client = httpClient(server.url ?? "");
    const init = await handshake(client);

    expect(init.serverInfo).toEqual({ name: "warlock", version: "5.31.0" });

    const { tools } = await client.call<ToolsList>("tools/list");
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "inspect_app",
        "inspect_routes",
        "inspect_models",
        "inspect_config",
        "db_schema",
        "docs_search",
        "docs_read",
        "explain",
        "check_run",
        "test_run",
        "requests_recent",
        "request_log",
        "generate_make",
        "generate_add",
      ]),
    );
    expect(names.every((name) => /^[a-zA-Z0-9_-]{1,128}$/.test(name))).toBe(true);

    const routes = await callTool(client, "inspect_routes", { unguardedWrites: true });

    expect(routes.isError).toBe(false);
    expect(routes.json()).toMatchObject({ routes: [{ method: "POST", path: "/posts" }], total: 3 });

    const schema = await callTool(client, "db_schema", { model: "Post" });

    expect(schema.json()).toMatchObject({
      tables: [
        {
          table: "posts",
          columns: expect.arrayContaining([
            expect.objectContaining({
              name: "authorId",
              references: { model: "User", column: "id" },
            }),
          ]),
        },
      ],
    });
  });

  it("is read-only by default: no write argument, and a write is refused with WL7005", async () => {
    const { server, calls } = await startHttp();
    const client = httpClient(server.url ?? "");

    await handshake(client);

    const { tools } = await client.call<ToolsList>("tools/list");
    const make = tools.find((tool) => tool.name === "generate_make");

    expect(make?.inputSchema.properties).not.toHaveProperty("write");

    const refused = await callTool(client, "generate_make", {
      generator: "service",
      name: "posts/publish",
      write: true,
    });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("WL7005");
    expect(calls.applies).toEqual([]);

    const preview = await callTool(client, "generate_make", {
      generator: "service",
      name: "posts/publish",
    });

    expect(preview.isError).toBe(false);
    expect(calls.plans).toEqual([
      { type: "make", generator: "service", name: "posts/publish", flags: {} },
    ]);
  });

  it("writes only with allowWrites", async () => {
    const { server, calls } = await startHttp({ allowWrites: true });
    const client = httpClient(server.url ?? "");

    await handshake(client);

    const { tools } = await client.call<ToolsList>("tools/list");

    expect(
      tools.find((tool) => tool.name === "generate_add")?.inputSchema.properties,
    ).toHaveProperty("write");

    const applied = await callTool(client, "generate_add", { features: ["devtools"], write: true });

    expect(applied.isError).toBe(false);
    expect(calls.applies).toEqual([{ type: "add", features: ["devtools"] }]);
  });

  it("rejects invalid arguments as a tool error, not a crash", async () => {
    const { server } = await startHttp();
    const client = httpClient(server.url ?? "");

    await handshake(client);

    const result = await callTool(client, "docs_search", { limit: "many" });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('"query" is required');
    expect(result.text).toContain('"limit" must be an integer');
  });

  it("requires the bearer token when one is set", async () => {
    const { server } = await startHttp({ token: "s3cret-token" });

    await expect(handshake(httpClient(server.url ?? ""))).rejects.toThrow();

    const authorized = httpClient(server.url ?? "", { authorization: "Bearer s3cret-token" });
    const explained = await (async () => {
      await handshake(authorized);
      return callTool(authorized, "explain", { code: "WL3001" });
    })();

    expect(explained.json()).toMatchObject({ code: "WL3001", category: "code" });
  });
});

describe("warlock mcp over stdio", () => {
  it("serves the same tools to a client that spawns it", async () => {
    const require = createRequire(__filename);
    const tsx = require.resolve("tsx");
    const client = createJsonRpcClient({
      type: "stdio",
      command: process.execPath,
      args: ["--import", pathToFileURL(tsx).href, path.join(here, "__fixtures__/stdio-server.ts")],
    });

    clients.push(client);

    const init = await handshake(client);

    expect(init.serverInfo).toMatchObject({ name: "warlock" });

    const recent = await client.call<CallResult>(
      "tools/call",
      { name: "requests_recent", arguments: { limit: 1 } },
      { timeoutMs: 20_000 },
    );
    const body: unknown = JSON.parse(recent.content[0]?.text ?? "{}");

    expect(body).toMatchObject({
      requests: [
        {
          id: "req-1",
          queries: [
            { id: "q1", nPlusOne: false },
            { id: "q2", nPlusOne: true },
          ],
          timings: { totalMs: 12, phasesMs: { middleware: 1, handler: 9 }, queriesMs: 3 },
        },
      ],
    });
  }, 60_000);
});

describe("transport rules", () => {
  it("knows loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });

  it("refuses a non-loopback host without a token (WL7004)", () => {
    expect(() => resolveMcpTransport({ type: "http", host: "0.0.0.0" })).toThrow(WarlockError);

    try {
      resolveMcpTransport({ type: "http", host: "0.0.0.0" });
    } catch (error) {
      expect(error instanceof WarlockError && error.code).toBe("WL7004");
    }

    expect(resolveMcpTransport({ type: "http", host: "0.0.0.0", token: "t" })).toMatchObject({
      host: "0.0.0.0",
      auth: { bearer: "t" },
    });
  });

  it("fails with WL7003 and the install line when ai-tools is missing", async () => {
    const missing = Object.assign(
      new Error("Cannot find package '@warlock.js/ai-tools' imported from x"),
      {
        code: "ERR_MODULE_NOT_FOUND",
      },
    );

    await expect(
      loadAiToolsServe("/nowhere", async () => {
        throw missing;
      }),
    ).rejects.toMatchObject({ code: "WL7003", message: expect.stringContaining("npm install -D") });
  });
});
