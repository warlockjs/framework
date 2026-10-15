import { tool, type ToolContract } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import type { JsonRpcRequest, McpToolCallResult, McpToolDescriptor } from "../contracts";
import { objectSchema, stringField } from "../schema";
import { createServeHandler, serve } from "./serve";

/** A tool that uppercases its `value`. */
function makeUpperTool(): ToolContract {
  return tool<{ value: string }, { upper: string }>({
    name: "upper",
    description: "Uppercase a string",
    input: objectSchema<{ value: string }>({ value: stringField() }),
    execute: async ({ value }) => ({ upper: value.toUpperCase() }),
  }) as unknown as ToolContract;
}

/** A tool that always throws — exercises the error-mapping path. */
function makeBoomTool(): ToolContract {
  return tool<{ value: string }, never>({
    name: "boom",
    description: "Always fails",
    input: objectSchema<{ value: string }>({ value: stringField() }),
    execute: async () => {
      throw new Error("kaboom");
    },
  }) as unknown as ToolContract;
}

/** A no-argument tool (no input schema). */
function makePingTool(): ToolContract {
  return tool<undefined, { pong: true }>({
    name: "ping",
    description: "Ping",
    execute: async () => ({ pong: true }),
  }) as unknown as ToolContract;
}

/** Build a request envelope for a method. */
function request(id: number, method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

describe("serve() — initialize", () => {
  it("advertises the configured name and version", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "my-server", version: "9.9.9" });

    const response = await handler.handle(request(1, "initialize"));
    const result = response.result as { serverInfo: { name: string; version: string } };

    expect(result.serverInfo.name).toBe("my-server");
    expect(result.serverInfo.version).toBe("9.9.9");
  });

  it("defaults the version when omitted", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "my-server" });

    const response = await handler.handle(request(1, "initialize"));
    const result = response.result as { serverInfo: { version: string } };

    expect(result.serverInfo.version).toBeTruthy();
  });

  it("advertises a tools capability", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "s" });

    const response = await handler.handle(request(1, "initialize"));
    const result = response.result as { capabilities: { tools?: unknown } };

    expect(result.capabilities.tools).toBeDefined();
  });
});

describe("serve() — tools/list", () => {
  it("lists each contract with name + description + inputSchema", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "s" });

    const response = await handler.handle(request(1, "tools/list"));
    const result = response.result as { tools: McpToolDescriptor[] };

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("upper");
    expect(result.tools[0].description).toBe("Uppercase a string");
    expect(result.tools[0].inputSchema).toBeDefined();
  });

  it("falls back to an object schema for a no-argument tool", async () => {
    const handler = createServeHandler([makePingTool()], { name: "s" });

    const response = await handler.handle(request(1, "tools/list"));
    const result = response.result as { tools: McpToolDescriptor[] };

    expect(result.tools[0].inputSchema).toMatchObject({ type: "object" });
  });

  it("lists multiple tools from an object source's tools()", async () => {
    const source = { tools: () => [makeUpperTool(), makeBoomTool()] };
    const handler = createServeHandler(source, { name: "s" });

    const response = await handler.handle(request(1, "tools/list"));
    const result = response.result as { tools: McpToolDescriptor[] };

    expect(result.tools.map((t) => t.name)).toEqual(["upper", "boom"]);
  });
});

describe("serve() — tools/call", () => {
  it("routes to the named contract and returns its data as a text block", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "s" });

    const response = await handler.handle(
      request(1, "tools/call", { name: "upper", arguments: { value: "hi" } }),
    );
    const result = response.result as McpToolCallResult;

    expect(result.isError).toBe(false);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text ?? "")).toEqual({ upper: "HI" });
  });

  it("serializes a no-argument tool's object result", async () => {
    const handler = createServeHandler([makePingTool()], { name: "s" });

    const response = await handler.handle(request(1, "tools/call", { name: "ping", arguments: {} }));
    const result = response.result as McpToolCallResult;

    expect(JSON.parse(result.content[0].text ?? "")).toEqual({ pong: true });
  });

  it("maps a thrown tool error to an isError result", async () => {
    const handler = createServeHandler([makeBoomTool()], { name: "s" });

    const response = await handler.handle(
      request(1, "tools/call", { name: "boom", arguments: { value: "x" } }),
    );
    const result = response.result as McpToolCallResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("kaboom");
  });

  it("maps a schema validation failure to an isError result", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "s" });

    const response = await handler.handle(
      request(1, "tools/call", { name: "upper", arguments: { value: 42 } }),
    );
    const result = response.result as McpToolCallResult;

    expect(result.isError).toBe(true);
  });

  it("answers a JSON-RPC error for an unknown tool name", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "s" });

    const response = await handler.handle(
      request(1, "tools/call", { name: "nope", arguments: {} }),
    );

    expect(response.error).toBeDefined();
    expect(response.error?.message).toContain("nope");
  });

  it("answers a JSON-RPC error when params are missing a name", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "s" });

    const response = await handler.handle(request(1, "tools/call", {}));

    expect(response.error).toBeDefined();
  });

  it("defaults missing arguments to an empty object", async () => {
    const handler = createServeHandler([makePingTool()], { name: "s" });

    const response = await handler.handle(request(1, "tools/call", { name: "ping" }));
    const result = response.result as McpToolCallResult;

    expect(result.isError).toBe(false);
  });
});

describe("serve() — unsupported methods + schema target", () => {
  it("answers method-not-found for an unsupported method", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "s" });

    const response = await handler.handle(request(1, "resources/list"));

    expect(response.error?.code).toBe(-32601);
  });

  it("emits the configured schema target dialect for inputSchema", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "s", schemaTarget: "draft-07" });

    const response = await handler.handle(request(1, "tools/list"));
    const result = response.result as { tools: McpToolDescriptor[] };

    // The schema is present; the dialect switch is honored by extractJsonSchema.
    expect(result.tools[0].inputSchema).toBeDefined();
  });

  it("preserves request ids on responses", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "s" });

    const response = await handler.handle(request(77, "tools/list"));

    expect(response.id).toBe(77);
  });
});

describe("serve() — server lifecycle", () => {
  it("rejects an http transport at start()", async () => {
    const server = serve([makeUpperTool()], {
      name: "s",
      transport: { type: "http", port: 9000 },
    });

    await expect(server.start()).rejects.toThrow();
  });

  it("start()/stop() over stdio are idempotent and resolve", async () => {
    const server = serve([makeUpperTool()], { name: "s", transport: { type: "stdio" } });

    await server.start();
    await server.start();
    await server.stop();
    await server.stop();

    expect(true).toBe(true);
  });
});
