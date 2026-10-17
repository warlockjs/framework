import { tool, type ToolContract } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import type { JsonRpcRequest, McpToolCallResult, McpToolDescriptor } from "../contracts";
import { objectSchema, stringField } from "../schema";
import { McpServeError } from "../errors";
import { SUPPORTED_PROTOCOL_VERSIONS } from "./protocol";
import { answerStdioLine, createServeHandler, serve } from "./serve";

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

    const response = await handler.handle(
      request(1, "tools/call", { name: "ping", arguments: {} }),
    );
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
  it("binds an http transport at start() and resolves its url", async () => {
    const server = serve([makeUpperTool()], {
      name: "s",
      transport: { type: "http", port: 0 },
    });

    const handle = await server.start();

    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    await server.stop();
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

describe("serve() — protocol negotiation and ping", () => {
  it("echoes a supported requested protocol version", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "s" });

    const response = await handler.handle(
      request(1, "initialize", { protocolVersion: "2025-03-26" }),
    );

    expect((response.result as { protocolVersion: string }).protocolVersion).toBe("2025-03-26");
  });

  it("answers the newest version for an unknown request", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "s" });

    const response = await handler.handle(
      request(1, "initialize", { protocolVersion: "1999-01-01" }),
    );

    expect((response.result as { protocolVersion: string }).protocolVersion).toBe(
      SUPPORTED_PROTOCOL_VERSIONS[0],
    );
  });

  it("answers ping with an empty result", async () => {
    const handler = createServeHandler([makeUpperTool()], { name: "s" });

    expect((await handler.handle(request(1, "ping"))).result).toEqual({});
  });
});

describe("serve() — collisions", () => {
  it("throws a collision error for duplicate tool names", () => {
    let failure: unknown;

    try {
      createServeHandler([makeUpperTool(), makeUpperTool()], { name: "s" });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(McpServeError);
    expect((failure as McpServeError).type).toBe("collision");
  });

  it("throws for duplicate resource URIs and prompt names", () => {
    const resource = { uri: "docs://a", name: "a", read: () => "x" };
    const prompt = { name: "p", get: () => "x" };

    expect(() => createServeHandler([], { name: "s", resources: [resource, resource] })).toThrow(
      McpServeError,
    );
    expect(() => createServeHandler([], { name: "s", prompts: [prompt, prompt] })).toThrow(
      McpServeError,
    );
  });
});

describe("serve() — resources", () => {
  const handler = createServeHandler([makeUpperTool()], {
    name: "s",
    resources: [
      {
        uri: "docs://guide",
        name: "guide",
        title: "The guide",
        mimeType: "text/markdown",
        read: () => "# Guide",
      },
      {
        uri: "blob://logo",
        name: "logo",
        mimeType: "image/png",
        read: async () => new Uint8Array([1, 2, 3]),
      },
    ],
  });

  it("advertises the resources capability only when resources are configured", async () => {
    const plain = createServeHandler([makeUpperTool()], { name: "s" });
    const withResources = await handler.handle(request(1, "initialize"));
    const without = await plain.handle(request(1, "initialize"));

    expect(withResources.result).toMatchObject({ capabilities: { resources: {} } });
    expect(
      (without.result as { capabilities: Record<string, unknown> }).capabilities.resources,
    ).toBe(undefined);
  });

  it("lists resource metadata", async () => {
    const response = await handler.handle(request(1, "resources/list"));

    expect(response.result).toEqual({
      resources: [
        { uri: "docs://guide", name: "guide", title: "The guide", mimeType: "text/markdown" },
        { uri: "blob://logo", name: "logo", mimeType: "image/png" },
      ],
    });
  });

  it("reads text and binary resources", async () => {
    const text = await handler.handle(request(1, "resources/read", { uri: "docs://guide" }));
    const blob = await handler.handle(request(2, "resources/read", { uri: "blob://logo" }));

    expect(text.result).toEqual({
      contents: [{ uri: "docs://guide", mimeType: "text/markdown", text: "# Guide" }],
    });
    expect(blob.result).toEqual({
      contents: [{ uri: "blob://logo", mimeType: "image/png", blob: "AQID" }],
    });
  });

  it("answers -32002 for an unknown resource", async () => {
    const response = await handler.handle(request(1, "resources/read", { uri: "docs://nope" }));

    expect(response.error?.code).toBe(-32002);
  });

  it("lists no resource templates", async () => {
    const response = await handler.handle(request(1, "resources/templates/list"));

    expect(response.result).toEqual({ resourceTemplates: [] });
  });
});

describe("serve() — prompts", () => {
  const handler = createServeHandler([], {
    name: "s",
    prompts: [
      {
        name: "review",
        description: "Review code",
        arguments: [{ name: "code", required: true }],
        get: (args) => `Review:\n${args.code ?? ""}`,
      },
      {
        name: "chat",
        get: () => [
          { role: "user", content: { type: "text", text: "hi" } },
          { role: "assistant", content: { type: "text", text: "hello" } },
        ],
      },
    ],
  });

  it("lists prompts with their arguments", async () => {
    const response = await handler.handle(request(1, "prompts/list"));

    expect(response.result).toEqual({
      prompts: [
        {
          name: "review",
          description: "Review code",
          arguments: [{ name: "code", required: true }],
        },
        { name: "chat" },
      ],
    });
  });

  it("builds a string prompt as one user message", async () => {
    const response = await handler.handle(
      request(1, "prompts/get", { name: "review", arguments: { code: "x = 1" } }),
    );

    expect(response.result).toEqual({
      description: "Review code",
      messages: [{ role: "user", content: { type: "text", text: "Review:\nx = 1" } }],
    });
  });

  it("passes message arrays through", async () => {
    const response = await handler.handle(request(1, "prompts/get", { name: "chat" }));

    expect((response.result as { messages: unknown[] }).messages).toHaveLength(2);
  });

  it("answers invalid params for a missing required argument or unknown prompt", async () => {
    const missing = await handler.handle(request(1, "prompts/get", { name: "review" }));
    const unknown = await handler.handle(request(2, "prompts/get", { name: "nope" }));
    const nonString = await handler.handle(
      request(3, "prompts/get", { name: "review", arguments: { code: 5 } }),
    );

    expect(missing.error?.code).toBe(-32602);
    expect(unknown.error?.code).toBe(-32602);
    expect(nonString.error?.code).toBe(-32602);
  });
});

describe("serve() — call context", () => {
  it("threads the request headers and signal into the tool context", async () => {
    let seen: { tenant?: string | undefined; signal?: AbortSignal | undefined } = {};
    const probe = tool<undefined, string>({
      name: "probe",
      description: "Captures its context",
      execute: async (_input, ctx) => {
        seen = { tenant: ctx?.request?.headers["x-tenant-id"], signal: ctx?.signal };
        return "ok";
      },
    }) as unknown as ToolContract;
    const controller = new AbortController();
    const handler = createServeHandler([probe], { name: "s" });

    await handler.handle(request(1, "tools/call", { name: "probe" }), {
      request: { method: "POST", path: "/mcp", headers: { "x-tenant-id": "acme" } },
      signal: controller.signal,
    });

    expect(seen.tenant).toBe("acme");
    expect(seen.signal).toBe(controller.signal);
  });
});

/** A dispatcher that answers every request with an empty result. */
async function echoDispatch(message: JsonRpcRequest) {
  return { jsonrpc: "2.0" as const, id: message.id, result: {} };
}

describe("answerStdioLine() — the stdio transport's line handler", () => {
  const dispatch = echoDispatch;

  it("answers a JSON value that is not a request object with Invalid Request", async () => {
    for (const line of ["null", "42", '"text"', "[1,2]", "true"]) {
      const reply = await answerStdioLine(line, dispatch);

      expect(JSON.parse(reply ?? "")).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid request: not a JSON-RPC object." },
      });
    }
  });

  it("ignores blank lines, non-JSON lines and notifications", async () => {
    expect(await answerStdioLine("   ", dispatch)).toBeUndefined();
    expect(await answerStdioLine("{not json", dispatch)).toBeUndefined();
    expect(
      await answerStdioLine('{"jsonrpc":"2.0","method":"notifications/initialized"}', dispatch),
    ).toBeUndefined();
  });

  it("answers a request on one line", async () => {
    const reply = await answerStdioLine('{"jsonrpc":"2.0","id":7,"method":"ping"}', dispatch);

    expect(reply).toBe('{"jsonrpc":"2.0","id":7,"result":{}}\n');
  });

  it("answers an internal error instead of rejecting when dispatch throws", async () => {
    const reply = await answerStdioLine('{"jsonrpc":"2.0","id":3,"method":"ping"}', async () => {
      throw new Error("boom");
    });

    expect(JSON.parse(reply ?? "")).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32603, message: "Internal error." },
    });
  });
});
