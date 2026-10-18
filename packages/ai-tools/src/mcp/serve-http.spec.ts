import { createServer as createNetServer } from "node:net";
import { request as httpRequest } from "node:http";
import { tool, type ToolContract } from "@warlock.js/ai";
import { afterEach, describe, expect, it } from "vitest";
import type {
  McpHttpServeHandle,
  McpHttpServeTransport,
  McpServeOptions,
  McpServeSource,
  McpToolCallResult,
} from "../contracts";
import { McpServeError } from "../errors";
import { objectSchema, stringField } from "../schema";
import { mcp } from "./client";
import { isLoopbackHost } from "./serve-http";
import { serve } from "./serve";
import { mcpResult } from "../index";

/** A tool that uppercases its `value`. */
function upperTool(name = "upper"): ToolContract {
  return tool<{ value: string }, { upper: string }>({
    name,
    description: "Uppercase a string",
    input: objectSchema<{ value: string }>({ value: stringField() }),
    execute: async ({ value }) => ({ upper: value.toUpperCase() }),
  }) as unknown as ToolContract;
}

/** A tool that echoes one inbound request header from its context. */
function headerTool(): ToolContract {
  return tool<undefined, { tenant: string | null; remote: string | null }>({
    name: "whoami",
    description: "Echo the x-tenant-id request header",
    execute: async (_input, ctx) => ({
      tenant: ctx?.request?.headers["x-tenant-id"] ?? null,
      remote: ctx?.request?.remoteAddress ?? null,
    }),
  }) as unknown as ToolContract;
}

/** A tool that waits for `release()` (or its abort signal) before answering. */
function gatedTool(): { contract: ToolContract; release(): void; aborted(): boolean } {
  let release: () => void = () => undefined;
  let aborted = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const contract = tool<undefined, string>({
    name: "slow",
    description: "Waits for the test to release it",
    execute: async (_input, ctx) => {
      await new Promise<void>((resolve) => {
        void gate.then(resolve);
        ctx?.signal?.addEventListener("abort", () => {
          aborted = true;
          resolve();
        });
      });

      return "done";
    },
  }) as unknown as ToolContract;

  return { contract, release: () => release(), aborted: () => aborted };
}

/** Handles opened by a test, closed after it. */
const opened: McpHttpServeHandle[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((handle) => handle.close()));
});

/** Start an HTTP MCP server on an ephemeral loopback port. */
async function start(
  source: McpServeSource,
  transport: Omit<McpHttpServeTransport, "type"> = {},
  options: Omit<McpServeOptions, "name" | "transport"> = {},
): Promise<McpHttpServeHandle> {
  const handle = await serve(source, {
    name: "test-server",
    ...options,
    transport: { type: "http", port: 0, ...transport },
  }).start();

  opened.push(handle);

  return handle;
}

/** The raw HTTP exchange a test inspects. */
type RawResponse = { status: number; headers: Record<string, string>; body: string };

/** Send a raw HTTP request with full control over headers (including Host). */
function raw(
  url: string,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<RawResponse> {
  const target = new URL(url);

  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        method: options.method ?? "POST",
        path: options.path ?? target.pathname,
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const headers: Record<string, string> = {};

          for (const [name, value] of Object.entries(response.headers)) {
            if (typeof value === "string") {
              headers[name] = value;
            }
          }

          resolve({
            status: response.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

/** Default headers of a well-formed Streamable HTTP POST. */
const JSON_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

/** POST one JSON-RPC message. */
function rpc(
  url: string,
  message: unknown,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  return raw(url, { headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(message) });
}

/** A `tools/list` request body. */
const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };

/** True when something can bind `port` on loopback again. */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();

    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

describe("serve() over http — binding", () => {
  it("binds 127.0.0.1 on an ephemeral port at /mcp by default", async () => {
    const handle = await start([upperTool()]);
    const url = new URL(handle.url);

    expect(url.hostname).toBe("127.0.0.1");
    expect(Number(url.port)).toBeGreaterThan(0);
    expect(url.pathname).toBe("/mcp");
  });

  it("honours a custom path", async () => {
    const handle = await start([upperTool()], { path: "/agents/session-1" });

    expect(new URL(handle.url).pathname).toBe("/agents/session-1");
    expect((await rpc(handle.url, LIST)).status).toBe(200);
  });

  it("refuses a non-loopback bind without auth", async () => {
    const server = serve([upperTool()], {
      name: "s",
      transport: { type: "http", host: "0.0.0.0", port: 0 },
    });

    const failure = await server.start().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(McpServeError);
    expect((failure as McpServeError).type).toBe("config");
  });

  it("allows a non-loopback bind once auth is configured", async () => {
    const handle = await start([upperTool()], {
      host: "0.0.0.0",
      auth: { bearer: "s3cret-token" },
    });
    const port = new URL(handle.url).port;
    const loopbackUrl = `http://127.0.0.1:${port}/mcp`;

    expect((await rpc(loopbackUrl, LIST)).status).toBe(401);
    expect((await rpc(loopbackUrl, LIST, { authorization: "Bearer s3cret-token" })).status).toBe(
      200,
    );
  });

  it("rejects empty bearer tokens and an auth object with no check", async () => {
    await expect(start([upperTool()], { auth: { bearer: "" } })).rejects.toBeInstanceOf(
      McpServeError,
    );
    await expect(start([upperTool()], { auth: {} })).rejects.toBeInstanceOf(McpServeError);
  });

  it("reports a port already in use as a listen error", async () => {
    const first = await start([upperTool()]);
    const port = Number(new URL(first.url).port);

    const failure = await start([upperTool()], { port }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(McpServeError);
    expect((failure as McpServeError).type).toBe("listen");
  });

  it("classifies loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.8.9.10")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("::")).toBe(false);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
  });
});

describe("serve() over http — authentication", () => {
  it("answers 401 with a Bearer challenge when the token is missing", async () => {
    const handle = await start([upperTool()], { auth: { bearer: "right-token" } });

    const response = await rpc(handle.url, LIST);

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("Bearer");
  });

  it("answers 401 for a wrong token, a token of another length, or another scheme", async () => {
    const handle = await start([upperTool()], { auth: { bearer: "right-token" } });

    expect((await rpc(handle.url, LIST, { authorization: "Bearer wrong-token" })).status).toBe(401);
    expect((await rpc(handle.url, LIST, { authorization: "Bearer right-token-x" })).status).toBe(
      401,
    );
    expect((await rpc(handle.url, LIST, { authorization: "Basic right-token" })).status).toBe(401);
  });

  it("accepts the correct token, and any token of a rotation list", async () => {
    const handle = await start([upperTool()], { auth: { bearer: ["old-token", "new-token"] } });

    expect((await rpc(handle.url, LIST, { authorization: "Bearer old-token" })).status).toBe(200);
    expect((await rpc(handle.url, LIST, { authorization: "bearer new-token" })).status).toBe(200);
  });

  it("runs a custom authorize hook with the request metadata", async () => {
    const seen: string[] = [];
    const handle = await start([upperTool()], {
      auth: {
        authorize: (request) => {
          seen.push(`${request.method} ${request.path}`);

          return request.headers["x-api-key"] === "k-1";
        },
      },
    });

    expect((await rpc(handle.url, LIST)).status).toBe(401);
    expect((await rpc(handle.url, LIST, { "x-api-key": "k-1" })).status).toBe(200);
    expect(seen).toEqual(["POST /mcp", "POST /mcp"]);
  });

  it("denies when the authorize hook throws", async () => {
    const handle = await start([upperTool()], {
      auth: {
        authorize: () => {
          throw new Error("auth backend down");
        },
      },
    });

    expect((await rpc(handle.url, LIST)).status).toBe(401);
  });

  it("requires both checks when bearer and authorize are set", async () => {
    const handle = await start([upperTool()], {
      auth: { bearer: "tok", authorize: (request) => request.headers["x-user"] === "ada" },
    });

    expect((await rpc(handle.url, LIST, { authorization: "Bearer tok" })).status).toBe(401);
    expect((await rpc(handle.url, LIST, { "x-user": "ada" })).status).toBe(401);
    expect(
      (await rpc(handle.url, LIST, { authorization: "Bearer tok", "x-user": "ada" })).status,
    ).toBe(200);
  });
});

describe("serve() over http — DNS-rebinding guards", () => {
  it("refuses a foreign Origin with 403", async () => {
    const handle = await start([upperTool()]);

    const response = await rpc(handle.url, LIST, { origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({ jsonrpc: "2.0", id: null });
  });

  it("refuses the opaque `null` origin", async () => {
    const handle = await start([upperTool()]);

    expect((await rpc(handle.url, LIST, { origin: "null" })).status).toBe(403);
  });

  it("accepts loopback origins and configured allowedOrigins", async () => {
    const handle = await start([upperTool()], { allowedOrigins: ["https://app.example.com"] });

    expect((await rpc(handle.url, LIST, { origin: "http://localhost:5173" })).status).toBe(200);
    expect((await rpc(handle.url, LIST, { origin: "http://127.0.0.1:8080" })).status).toBe(200);
    expect((await rpc(handle.url, LIST, { origin: "https://app.example.com" })).status).toBe(200);
    expect((await rpc(handle.url, LIST, { origin: "https://app.example.org" })).status).toBe(403);
  });

  it("refuses a non-loopback Host header while bound to loopback", async () => {
    const handle = await start([upperTool()]);

    expect((await rpc(handle.url, LIST, { host: "rebound.evil.example" })).status).toBe(403);
    expect((await rpc(handle.url, LIST, { host: "localhost" })).status).toBe(200);
  });

  it("accepts extra Host names from allowedHosts", async () => {
    const handle = await start([upperTool()], { allowedHosts: ["mcp.internal"] });

    expect((await rpc(handle.url, LIST, { host: "mcp.internal:443" })).status).toBe(200);
  });

  it("checks Origin before auth", async () => {
    const handle = await start([upperTool()], { auth: { bearer: "tok" } });

    const response = await rpc(handle.url, LIST, {
      authorization: "Bearer tok",
      origin: "https://evil.example",
    });

    expect(response.status).toBe(403);
  });
});

describe("serve() over http — Streamable HTTP framing", () => {
  it("answers a request with application/json", async () => {
    const handle = await start([upperTool()]);

    const response = await rpc(handle.url, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "upper", arguments: { value: "hi" } },
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");

    const body = JSON.parse(response.body) as {
      id: number;
      result: { content: { text: string }[] };
    };

    expect(body.id).toBe(7);
    expect(JSON.parse(body.result.content[0]?.text ?? "")).toEqual({ upper: "HI" });
  });

  it("acknowledges notifications and responses with 202 and no body", async () => {
    const handle = await start([upperTool()]);

    const notification = await rpc(handle.url, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    const reply = await rpc(handle.url, { jsonrpc: "2.0", id: 3, result: {} });

    expect(notification.status).toBe(202);
    expect(notification.body).toBe("");
    expect(reply.status).toBe(202);
  });

  it("answers 405 for GET and DELETE (stateless, no SSE stream)", async () => {
    const handle = await start([upperTool()]);

    const get = await raw(handle.url, { method: "GET", headers: { accept: "text/event-stream" } });
    const remove = await raw(handle.url, { method: "DELETE" });

    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe("POST");
    expect(remove.status).toBe(405);
  });

  it("answers 404 off the endpoint path", async () => {
    const handle = await start([upperTool()]);

    expect(
      (await raw(handle.url, { path: "/other", headers: JSON_HEADERS, body: "{}" })).status,
    ).toBe(404);
  });

  it("rejects bad content types, batches, invalid JSON and unknown protocol versions", async () => {
    const handle = await start([upperTool()]);

    const text = await raw(handle.url, {
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(LIST),
    });
    const batch = await rpc(handle.url, [LIST, LIST]);
    const broken = await raw(handle.url, { headers: JSON_HEADERS, body: "{not json" });
    const version = await rpc(handle.url, LIST, { "mcp-protocol-version": "1999-01-01" });
    const notAccepted = await rpc(handle.url, LIST, { accept: "text/html" });

    expect(text.status).toBe(415);
    expect(batch.status).toBe(400);
    expect(broken.status).toBe(400);
    expect(JSON.parse(broken.body)).toMatchObject({ error: { code: -32700 } });
    expect(version.status).toBe(400);
    expect(notAccepted.status).toBe(406);
  });

  it("accepts a supported MCP-Protocol-Version header", async () => {
    const handle = await start([upperTool()]);

    expect((await rpc(handle.url, LIST, { "mcp-protocol-version": "2025-06-18" })).status).toBe(
      200,
    );
  });

  it("refuses bodies over maxBodyBytes with 413", async () => {
    const handle = await start([upperTool()], { maxBodyBytes: 256 });

    const response = await rpc(handle.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "upper", arguments: { value: "x".repeat(2_000) } },
    });

    expect(response.status).toBe(413);
  });
});

describe("serve() over http — tool context", () => {
  it("hands the inbound request headers to tools on ctx.request", async () => {
    const handle = await start([headerTool()], { auth: { bearer: "tok" } });

    const response = await rpc(
      handle.url,
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } },
      { authorization: "Bearer tok", "x-tenant-id": "acme" },
    );
    const body = JSON.parse(response.body) as { result: { content: { text: string }[] } };
    const data = JSON.parse(body.result.content[0]?.text ?? "") as {
      tenant: string;
      remote: string;
    };

    expect(data.tenant).toBe("acme");
    expect(data.remote).toContain("127.0.0.1");
  });
});

describe("serve() over http — tool-name collisions", () => {
  it("throws at serve() when two tools share a name", () => {
    expect(() =>
      serve([upperTool("dup"), upperTool("dup")], { name: "s", transport: { type: "http" } }),
    ).toThrow(McpServeError);
  });

  it("throws for the same name across groups unless prefixToolNames is on", async () => {
    const source = { groups: { left: [upperTool()], right: [upperTool()] } };

    let failure: unknown;

    try {
      serve(source, { name: "s", transport: { type: "http" } });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(McpServeError);
    expect((failure as McpServeError).type).toBe("collision");

    const handle = await start(source, {}, { prefixToolNames: true });
    const listed = JSON.parse((await rpc(handle.url, LIST)).body) as {
      result: { tools: { name: string }[] };
    };

    expect(listed.result.tools.map((entry) => entry.name)).toEqual(["left_upper", "right_upper"]);

    const called = JSON.parse(
      (
        await rpc(handle.url, {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "right_upper", arguments: { value: "ok" } },
        })
      ).body,
    ) as { result: { isError: boolean } };

    expect(called.result.isError).toBe(false);
  });

  it("accepts a custom prefix builder", async () => {
    const handle = await start(
      { groups: { github: [upperTool()] } },
      {},
      { prefixToolNames: (group, name) => `${group}.${name}` },
    );
    const listed = JSON.parse((await rpc(handle.url, LIST)).body) as {
      result: { tools: { name: string }[] };
    };

    expect(listed.result.tools[0]?.name).toBe("github.upper");
  });

  it("rejects prefixToolNames on an ungrouped source", () => {
    expect(() => serve([upperTool()], { name: "s", prefixToolNames: true })).toThrow(McpServeError);
  });
});

describe("serve() over http — close()", () => {
  it("frees the port", async () => {
    const handle = await serve([upperTool()], {
      name: "s",
      transport: { type: "http", port: 0 },
    }).start();
    const port = Number(new URL(handle.url).port);

    expect(await portIsFree(port)).toBe(false);

    await handle.close();
    await handle.close(); // idempotent

    expect(await portIsFree(port)).toBe(true);
  });

  it("lets an in-flight call finish before resolving", async () => {
    const gated = gatedTool();
    const handle = await serve([gated.contract], {
      name: "s",
      transport: { type: "http", port: 0 },
    }).start();

    const pending = rpc(handle.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "slow", arguments: {} },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    let closed = false;
    const closing = handle.close().then(() => {
      closed = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(false);

    gated.release();

    const response = await pending;
    await closing;

    expect(response.status).toBe(200);
    expect(closed).toBe(true);
    expect(gated.aborted()).toBe(false);
  });

  it("aborts ctx.signal and drops connections after drainTimeoutMs", async () => {
    const gated = gatedTool();
    const handle = await serve([gated.contract], {
      name: "s",
      transport: { type: "http", port: 0, drainTimeoutMs: 50 },
    }).start();
    const port = Number(new URL(handle.url).port);

    const pending = rpc(handle.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "slow", arguments: {} },
    }).catch((error: unknown) => error);

    await new Promise((resolve) => setTimeout(resolve, 50));
    await handle.close();
    await pending;

    expect(gated.aborted()).toBe(true);
    expect(await portIsFree(port)).toBe(true);
  });

  it("can start again after close()", async () => {
    const server = serve([upperTool()], { name: "s", transport: { type: "http", port: 0 } });

    const first = await server.start();
    await first.close();

    const second = await server.start();
    opened.push(second);

    expect((await rpc(second.url, LIST)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Real MCP client round-trips
// ---------------------------------------------------------------------------

/** The slice of the official SDK client these specs drive. */
type SdkClient = {
  connect(transport: unknown): Promise<void>;
  getServerCapabilities(): Record<string, unknown> | undefined;
  listTools(): Promise<{
    tools: { name: string; description?: string; outputSchema?: Record<string, unknown> }[];
  }>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<McpToolCallResult>;
  listResources(): Promise<{ resources: { uri: string; name: string }[] }>;
  readResource(params: { uri: string }): Promise<{ contents: { uri: string; text?: string }[] }>;
  listPrompts(): Promise<{ prompts: { name: string }[] }>;
  getPrompt(params: {
    name: string;
    arguments?: Record<string, string>;
  }): Promise<{ messages: { role: string; content: { type: string; text?: string } }[] }>;
  close(): Promise<void>;
};

/** `@modelcontextprotocol/sdk/client/index.js`. */
type SdkClientModule = {
  Client: new (info: { name: string; version: string }) => SdkClient;
};

/** `@modelcontextprotocol/sdk/client/streamableHttp.js`. */
type SdkTransportModule = {
  StreamableHTTPClientTransport: new (
    url: URL,
    options?: { requestInit?: { headers?: Record<string, string> } },
  ) => unknown;
};

// Non-literal specifiers keep the optional SDK out of this package's type
// graph; the modules are resolved at runtime through the SDK's exports map.
const SDK_CLIENT = "@modelcontextprotocol/sdk/client/index.js";
const SDK_TRANSPORT = "@modelcontextprotocol/sdk/client/streamableHttp.js";

describe("serve() over http — real MCP clients", () => {
  it.each(["helper", "option"] as const)(
    "round-trips native results and request identity with the official SDK via %s",
    async (mode) => {
      const { Client } = (await import(SDK_CLIENT)) as SdkClientModule;
      const { StreamableHTTPClientTransport } = (await import(SDK_TRANSPORT)) as SdkTransportModule;
      const outputSchema = {
        type: "object",
        properties: { tenant: { type: "string" } },
        required: ["tenant"],
      };
      const identity = tool({
        name: "identity",
        description: "Return the calling tenant",
        meta: { outputSchema },
        execute: async (_input, ctx) => {
          const tenant = ctx?.request?.headers["x-tenant-id"] ?? "missing";
          const native = {
            content: [{ type: "text", text: "fixture" }],
            structuredContent: { tenant },
            _meta: { trace: tenant },
          };
          return mode === "helper" ? mcpResult(native) : native;
        },
      });
      const failure = tool({
        name: "failure",
        description: "Return a native tool error",
        execute: async () => {
          const native = { content: [{ type: "text", text: "fixture" }], isError: true };
          return mode === "helper" ? mcpResult(native) : native;
        },
      });
      const malformed = tool({
        name: "malformed",
        description: "Return an invalid payload",
        execute: async () => {
          const native = { content: [{ type: "text", text: 7 }] };
          return mode === "helper" ? mcpResult(native as unknown as McpToolCallResult) : native;
        },
      });
      const handle = await start(
        [identity, failure, malformed],
        { auth: { bearer: "native-token" } },
        { results: mode === "option" ? "native" : "text" },
      );

      for (const tenant of ["tenant-a", "tenant-b"]) {
        const client = new Client({ name: "native-client", version: "1.0.0" });
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(handle.url), {
              requestInit: {
                headers: { authorization: "Bearer native-token", "x-tenant-id": tenant },
              },
            }),
          );
          expect(
            (await client.listTools()).tools.find((entry) => entry.name === "identity")
              ?.outputSchema,
          ).toEqual(outputSchema);
          expect(await client.callTool({ name: "identity" })).toEqual({
            content: [{ type: "text", text: "fixture" }],
            structuredContent: { tenant },
            _meta: { trace: tenant },
          });
          expect(await client.callTool({ name: "failure" })).toEqual({
            content: [{ type: "text", text: "fixture" }],
            isError: true,
          });
          await expect(client.callTool({ name: "malformed" })).rejects.toMatchObject({
            code: -32603,
          });
        } finally {
          await client.close();
        }
      }
    },
  );

  it("round-trips list + call with the official MCP SDK client over bearer auth", async () => {
    const { Client } = (await import(SDK_CLIENT)) as SdkClientModule;
    const { StreamableHTTPClientTransport } = (await import(SDK_TRANSPORT)) as SdkTransportModule;

    const handle = await start(
      [upperTool(), headerTool()],
      { auth: { bearer: "sdk-token" } },
      {
        resources: [
          { uri: "docs://readme", name: "readme", mimeType: "text/plain", read: () => "hello" },
        ],
        prompts: [
          {
            name: "greet",
            arguments: [{ name: "who", required: true }],
            get: (args) => `Say hi to ${args.who ?? ""}`,
          },
        ],
      },
    );

    const client = new Client({ name: "spec-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(handle.url), {
      requestInit: { headers: { authorization: "Bearer sdk-token", "x-tenant-id": "sdk" } },
    });

    await client.connect(transport);

    try {
      const listed = await client.listTools();

      expect(listed.tools.map((entry) => entry.name).sort()).toEqual(["upper", "whoami"]);

      const called = await client.callTool({ name: "upper", arguments: { value: "mcp" } });

      expect(called.isError).toBe(false);
      expect(JSON.parse(called.content[0]?.text ?? "")).toEqual({ upper: "MCP" });

      const who = await client.callTool({ name: "whoami", arguments: {} });

      expect(JSON.parse(who.content[0]?.text ?? "")).toMatchObject({ tenant: "sdk" });

      expect(client.getServerCapabilities()).toMatchObject({ resources: {}, prompts: {} });
      expect((await client.listResources()).resources[0]?.uri).toBe("docs://readme");
      expect((await client.readResource({ uri: "docs://readme" })).contents[0]?.text).toBe("hello");
      expect((await client.listPrompts()).prompts[0]?.name).toBe("greet");

      const prompt = await client.getPrompt({ name: "greet", arguments: { who: "Ada" } });

      expect(prompt.messages[0]?.content.text).toBe("Say hi to Ada");
    } finally {
      await client.close();
    }
  });

  it("refuses the SDK client without the token", async () => {
    const { Client } = (await import(SDK_CLIENT)) as SdkClientModule;
    const { StreamableHTTPClientTransport } = (await import(SDK_TRANSPORT)) as SdkTransportModule;

    const handle = await start([upperTool()], { auth: { bearer: "sdk-token" } });
    const client = new Client({ name: "spec-client", version: "1.0.0" });

    await expect(
      client.connect(new StreamableHTTPClientTransport(new URL(handle.url))),
    ).rejects.toThrow();
  });

  it("round-trips with this package's own ai.mcp http client", async () => {
    const handle = await start([upperTool()], { auth: { bearer: "own-token" } });
    const client = mcp({
      type: "http",
      url: handle.url,
      headers: { authorization: "Bearer own-token" },
    });

    try {
      const tools = await client.tools();
      const upper = tools.find((entry) => entry.name === "upper");

      expect(upper).toBeDefined();

      const result = await upper?.invoke({ value: "own" });

      expect(result?.error).toBeUndefined();
      expect(result?.data).toEqual({ upper: "OWN" });
    } finally {
      await client.close();
    }
  });
});
