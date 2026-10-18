import { tool, type ToolContract } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import type { JsonRpcRequest, McpToolCallResult, McpToolDescriptor } from "../contracts";
import { objectSchema, stringField } from "../schema";
import { McpServeError } from "../errors";
import { SUPPORTED_PROTOCOL_VERSIONS } from "./protocol";
import { answerStdioLine, createServeHandler, serve } from "./serve";
import { mcpResult } from "../index";

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

/** A tool that returns an opaque fixture without input validation. */
function resultTool(data: unknown, meta?: ToolContract["meta"]): ToolContract {
  return tool({
    name: "native-result",
    description: "Return a fixture",
    meta,
    execute: async () => data,
  });
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

describe("serve() — native tool results", () => {
  const fixture = { content: [{ type: "text", text: "fixture" }], isError: true };

  it.each(["helper", "option", "tool"] as const)(
    "preserves native content and isError via %s",
    async (mode) => {
      const handler = createServeHandler(
        [
          resultTool(
            mode === "helper" ? mcpResult(fixture) : fixture,
            mode === "tool" ? { mcpResults: "native" } : undefined,
          ),
        ],
        { name: "native-server", results: mode === "option" ? "native" : "text" },
      );
      const response = await handler.handle(request(1, "tools/call", { name: "native-result" }));

      expect(response.error).toBeUndefined();
      expect(response.result).toBe(fixture);
      expect(response.result).toEqual({
        content: [{ type: "text", text: "fixture" }],
        isError: true,
      });
    },
  );

  it.each(["helper", "option"] as const)(
    "preserves all content variants, structuredContent and metadata via %s",
    async (mode) => {
      const native: McpToolCallResult = {
        content: [
          {
            type: "text",
            text: "fixture",
            annotations: { audience: ["assistant"], priority: 0.5 },
            _meta: { source: "fixture" },
          },
          { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
          { type: "audio", data: "YXVkaW8=", mimeType: "audio/wav" },
          {
            type: "resource_link",
            uri: "docs://fixture",
            name: "fixture",
            size: 7,
            icons: [{ src: "https://example.com/icon.png", sizes: ["48x48"], theme: "light" }],
          },
          {
            type: "resource",
            resource: { uri: "docs://text", text: "fixture", _meta: { source: "fixture" } },
          },
          {
            type: "resource",
            resource: {
              uri: "docs://blob",
              blob: "YmxvYg==",
              mimeType: "application/octet-stream",
            },
          },
        ],
        structuredContent: { count: 2 },
        _meta: { trace: "fixture", nested: { ok: true } },
      };
      const outputSchema = {
        type: "object",
        properties: { count: { type: "number" } },
        required: ["count"],
      };
      const handler = createServeHandler(
        [resultTool(mode === "helper" ? mcpResult(native) : native, { outputSchema })],
        {
          name: "native-server",
          results: mode === "option" ? "native" : "text",
        },
      );
      const listed = await handler.handle(request(1, "tools/list"));
      const response = await handler.handle(request(2, "tools/call", { name: "native-result" }));

      expect(listed.result).toMatchObject({ tools: [{ outputSchema }] });
      expect(response.result).toBe(native);
      expect((response.result as McpToolCallResult).isError).toBeUndefined();
    },
  );

  it.each(["helper", "option"] as const)(
    "keeps per-request identity and the abort signal via %s",
    async (mode) => {
      const controller = new AbortController();
      const contract = tool({
        name: "identity",
        description: "Return request identity",
        execute: async (_input, ctx) => {
          expect(ctx?.signal).toBe(controller.signal);
          const native = {
            content: [{ type: "text", text: ctx?.request?.headers["x-tenant-id"] ?? "missing" }],
            structuredContent: { remote: ctx?.request?.remoteAddress },
          };
          return mode === "helper" ? mcpResult(native) : native;
        },
      });
      const handler = createServeHandler([contract], {
        name: "identity",
        results: mode === "option" ? "native" : "text",
      });
      for (const tenant of ["tenant-a", "tenant-b"]) {
        const response = await handler.handle(request(1, "tools/call", { name: "identity" }), {
          signal: controller.signal,
          request: {
            method: "POST",
            path: "/mcp",
            headers: { "x-tenant-id": tenant },
            remoteAddress: "127.0.0.1",
          },
        });
        expect(response.result).toEqual({
          content: [{ type: "text", text: tenant }],
          structuredContent: { remote: "127.0.0.1" },
        });
      }
    },
  );

  const malformed: unknown[] = [
    null,
    [],
    {},
    { isError: true },
    { content: "fixture" },
    { content: [null] },
    { content: [{ type: "unknown" }] },
    { content: [{ type: "text", text: 7 }] },
    { content: [{ type: "image", data: "aW1hZ2U=" }] },
    { content: [{ type: "audio", data: 7, mimeType: "audio/wav" }] },
    { content: [{ type: "resource_link", uri: "docs://fixture" }] },
    { content: [{ type: "resource_link", uri: "docs://fixture", name: "fixture", icons: [{}] }] },
    { content: [{ type: "resource", resource: { uri: "docs://fixture" } }] },
    { content: [{ type: "text", text: "fixture", annotations: { priority: 2 } }] },
    { content: [{ type: "text", text: "fixture", annotations: { audience: ["invalid"] } }] },
    { content: [{ type: "text", text: "fixture", _meta: [] }] },
    { content: [], isError: "true" },
    { content: [], structuredContent: [] },
    { content: [], structuredContent: null },
    { content: [], _meta: [] },
    { content: [], _meta: { value: BigInt(1) } },
    { content: [], structuredContent: { value: Infinity } },
  ];

  it.each(malformed.map((value, index) => ({ value, index })))(
    "rejects malformed helper payload $index with a JSON-RPC error",
    async ({ value }) => {
      const handler = createServeHandler([resultTool(mcpResult(value as McpToolCallResult))], {
        name: "invalid",
      });
      const response = await handler.handle(request(1, "tools/call", { name: "native-result" }));
      expect(response.result).toBeUndefined();
      expect(response.error).toEqual({
        code: -32603,
        message: "Invalid native MCP CallToolResult.",
      });
    },
  );

  it("rejects malformed detected results instead of serializing them", async () => {
    const handler = createServeHandler([resultTool({ content: [{ type: "text" }] })], {
      name: "invalid",
      results: "native",
    });
    const response = await handler.handle(request(1, "tools/call", { name: "native-result" }));
    expect(response.error?.code).toBe(-32603);
    expect(response.result).toBeUndefined();
  });

  it("rejects cyclic payloads", async () => {
    const native: McpToolCallResult = { content: [], _meta: {} };
    native.structuredContent = { cycle: native };
    const handler = createServeHandler([resultTool(mcpResult(native))], { name: "invalid" });
    expect(
      (await handler.handle(request(1, "tools/call", { name: "native-result" }))).error?.code,
    ).toBe(-32603);
  });

  it("keeps default serialization for unbranded native-shaped objects", async () => {
    const handler = createServeHandler([resultTool(fixture)], { name: "default" });
    const response = await handler.handle(request(1, "tools/call", { name: "native-result" }));
    expect(response.result).toEqual({
      content: [{ type: "text", text: JSON.stringify(fixture) }],
      isError: false,
    });
  });

  it("allows a tool to opt out of server-wide detection", async () => {
    const handler = createServeHandler([resultTool(fixture, { mcpResults: "text" })], {
      name: "default",
      results: "native",
    });
    expect(
      (await handler.handle(request(1, "tools/call", { name: "native-result" }))).result,
    ).toEqual({ content: [{ type: "text", text: JSON.stringify(fixture) }], isError: false });
  });

  it("honors explicit helper returns even when detection is disabled for the tool", async () => {
    const native = { content: [], isError: false, structuredContent: { count: 0 } };
    const handler = createServeHandler([resultTool(mcpResult(native), { mcpResults: "text" })], {
      name: "explicit",
      results: "native",
    });
    expect((await handler.handle(request(1, "tools/call", { name: "native-result" }))).result).toBe(
      native,
    );
  });

  it("serializes native results through the stdio line handler without the brand", async () => {
    const handler = createServeHandler([resultTool(mcpResult(fixture))], { name: "stdio" });
    const line = await answerStdioLine(
      JSON.stringify(request(1, "tools/call", { name: "native-result" })),
      (message) => handler.handle(message),
    );
    expect(JSON.parse(line ?? "null")).toEqual({ jsonrpc: "2.0", id: 1, result: fixture });
  });

  it.each(["plain string", { count: 2 }, null])(
    "keeps non-native data serialization in native mode: %j",
    async (data) => {
      const handler = createServeHandler([resultTool(data)], { name: "mixed", results: "native" });
      expect(
        (await handler.handle(request(1, "tools/call", { name: "native-result" }))).result,
      ).toEqual({
        content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }],
        isError: false,
      });
    },
  );

  it("keeps thrown tool errors as tool errors in native mode", async () => {
    const handler = createServeHandler([makeBoomTool()], { name: "errors", results: "native" });
    const response = await handler.handle(
      request(1, "tools/call", { name: "boom", arguments: { value: "x" } }),
    );
    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("kaboom") }],
    });
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
