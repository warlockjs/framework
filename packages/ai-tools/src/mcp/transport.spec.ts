import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonRpcRequest, JsonRpcResponse } from "../contracts";
import { McpTransportError } from "../errors";
import { createJsonRpcClient, createTransport } from "./transport";
import type { McpTransportClient } from "./transport.type";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A minimal transport client (no `allocateId`) the JSON-RPC client must
 * augment with its own id source. Echoes a canned `result` for every
 * request unless a responder overrides it.
 */
class BareTransport implements McpTransportClient {
  public readonly requests: JsonRpcRequest[] = [];
  public closed = false;
  public lastNotify: string | undefined;

  public constructor(
    private readonly responder: (request: JsonRpcRequest) => JsonRpcResponse,
  ) {}

  public async request<TResult = unknown>(
    request: JsonRpcRequest,
  ): Promise<JsonRpcResponse<TResult>> {
    this.requests.push(request);

    return this.responder(request) as JsonRpcResponse<TResult>;
  }

  public async notify(method: string): Promise<void> {
    this.lastNotify = method;
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

describe("createJsonRpcClient — over an injected transport", () => {
  it("mints monotonic request ids when the transport has no allocator", async () => {
    const transport = new BareTransport((request) => ({
      jsonrpc: "2.0",
      id: request.id,
      result: { ok: true },
    }));

    const client = createJsonRpcClient(transport);
    await client.call("a");
    await client.call("b");

    expect(transport.requests.map((r) => r.id)).toEqual([1, 2]);
  });

  it("frames the JSON-RPC 2.0 envelope", async () => {
    const transport = new BareTransport((request) => ({
      jsonrpc: "2.0",
      id: request.id,
      result: {},
    }));

    const client = createJsonRpcClient(transport);
    await client.call("tools/list", { cursor: "x" });

    const [sent] = transport.requests;
    expect(sent.jsonrpc).toBe("2.0");
    expect(sent.method).toBe("tools/list");
    expect(sent.params).toEqual({ cursor: "x" });
  });

  it("unwraps the result member on success", async () => {
    const transport = new BareTransport((request) => ({
      jsonrpc: "2.0",
      id: request.id,
      result: { tools: [] },
    }));

    const result = await createJsonRpcClient(transport).call("tools/list");

    expect(result).toEqual({ tools: [] });
  });

  it("throws a typed McpTransportError on a JSON-RPC error member", async () => {
    const transport = new BareTransport((request) => ({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32000, message: "nope" },
    }));

    await expect(createJsonRpcClient(transport).call("tools/list")).rejects.toBeInstanceOf(
      McpTransportError,
    );
  });

  it("throws when the response has neither result nor error", async () => {
    const transport = new BareTransport((request) => ({ jsonrpc: "2.0", id: request.id }));

    await expect(createJsonRpcClient(transport).call("tools/list")).rejects.toThrow(
      /neither result nor error/i,
    );
  });

  it("delegates notify and close to the transport", async () => {
    const transport = new BareTransport((request) => ({
      jsonrpc: "2.0",
      id: request.id,
      result: {},
    }));

    const client = createJsonRpcClient(transport);
    await client.notify("notifications/initialized");
    await client.close();

    expect(transport.lastNotify).toBe("notifications/initialized");
    expect(transport.closed).toBe(true);
  });
});

/** Stub `globalThis.fetch` with a responder; record every call. */
function stubFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input.toString() : String(input);
      calls.push({ url, init: init ?? {} });

      return responder(url, init ?? {});
    }),
  );

  return calls;
}

describe("HTTP transport — Streamable HTTP over fetch", () => {
  it("POSTs the request and parses a JSON response", async () => {
    const calls = stubFetch((_url, init) => {
      const body = JSON.parse(String(init.body)) as JsonRpcRequest;

      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { hi: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = createJsonRpcClient({ type: "http", url: "https://srv.test/mcp" });
    const result = await client.call("ping");

    expect(result).toEqual({ hi: 1 });
    expect(calls[0].url).toBe("https://srv.test/mcp");
    expect(calls[0].init.method).toBe("POST");
  });

  it("sends static headers with every request", async () => {
    const calls = stubFetch(
      (_url, init) =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(String(init.body)).id, result: {} }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const client = createJsonRpcClient({
      type: "http",
      url: "https://srv.test/mcp",
      headers: { authorization: "Bearer t" },
    });
    await client.call("ping");

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer t");
  });

  it("parses a text/event-stream (SSE) response body", async () => {
    stubFetch((_url, init) => {
      const body = JSON.parse(String(init.body)) as JsonRpcRequest;
      const frame = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { sse: true } })}\n\n`;

      return new Response(frame, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const client = createJsonRpcClient({ type: "http", url: "https://srv.test/mcp" });
    const result = await client.call("ping");

    expect(result).toEqual({ sse: true });
  });

  it("throws a connect error on a non-OK HTTP status", async () => {
    stubFetch(() => new Response("nope", { status: 503 }));

    const client = createJsonRpcClient({ type: "http", url: "https://srv.test/mcp" });

    await expect(client.call("ping")).rejects.toBeInstanceOf(McpTransportError);
  });

  it("throws a protocol error on a non-JSON body", async () => {
    stubFetch(
      () => new Response("<<not json>>", { status: 200, headers: { "content-type": "application/json" } }),
    );

    const client = createJsonRpcClient({ type: "http", url: "https://srv.test/mcp" });

    await expect(client.call("ping")).rejects.toThrow(/non-JSON/i);
  });

  it("throws a protocol error on an empty body", async () => {
    stubFetch(
      () => new Response("", { status: 200, headers: { "content-type": "application/json" } }),
    );

    const client = createJsonRpcClient({ type: "http", url: "https://srv.test/mcp" });

    await expect(client.call("ping")).rejects.toThrow(/empty response/i);
  });

  it("maps a fetch rejection (network failure) to a connect error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const client = createJsonRpcClient({ type: "http", url: "https://srv.test/mcp" });

    await expect(client.call("ping")).rejects.toBeInstanceOf(McpTransportError);
  });

  it("close() is a no-op for the stateless HTTP transport", async () => {
    stubFetch(
      () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { status: 200 }),
    );

    const client = createJsonRpcClient({ type: "http", url: "https://srv.test/mcp" });

    await expect(client.close()).resolves.toBeUndefined();
  });
});

describe("stdio transport — real child process round-trip", () => {
  // A tiny echo server: reads newline-delimited JSON-RPC requests on stdin
  // and answers each with `result: { echoed: <method> }`.
  const ECHO_SERVER = `
    const readline = require("node:readline");
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const msg = JSON.parse(line);
      if (msg.id === undefined) return;
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echoed: msg.method } }) + "\\n");
    });
  `;

  it("spawns, frames a request over stdin, and correlates the stdout response", async () => {
    const client = createJsonRpcClient({
      type: "stdio",
      command: process.execPath,
      args: ["-e", ECHO_SERVER],
    });

    const result = await client.call<{ echoed: string }>("tools/list");

    expect(result.echoed).toBe("tools/list");

    await client.close();
  });

  it("correlates concurrent requests by id", async () => {
    const client = createJsonRpcClient({
      type: "stdio",
      command: process.execPath,
      args: ["-e", ECHO_SERVER],
    });

    const [a, b] = await Promise.all([
      client.call<{ echoed: string }>("alpha"),
      client.call<{ echoed: string }>("beta"),
    ]);

    expect(a.echoed).toBe("alpha");
    expect(b.echoed).toBe("beta");

    await client.close();
  });

  it("rejects in-flight calls when the transport is closed", async () => {
    const transport = createTransport({
      type: "stdio",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10000)"], // never answers
    });

    const pending = transport.request({ jsonrpc: "2.0", id: 1, method: "slow" });
    await transport.close();

    await expect(pending).rejects.toBeInstanceOf(McpTransportError);
  });

  it("surfaces a spawn failure as a connect error", () => {
    expect(() =>
      createTransport({ type: "stdio", command: "" }),
    ).toThrow(McpTransportError);
  });

  it("times out a request the server never answers", async () => {
    const client = createJsonRpcClient({
      type: "stdio",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10000)"],
    });

    await expect(client.call("slow", undefined, { timeoutMs: 50 })).rejects.toThrow(/timed out/i);

    await client.close();
  });
});
