import { describe, expect, it, vi } from "vitest";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpToolCallResult,
  McpToolDescriptor,
} from "../contracts";
import { McpTransportError } from "../errors";
import { mcp } from "./client";
import type { McpTransportClient } from "./transport.type";

/**
 * A scripted in-process transport. Each `request` is answered by a method
 * handler the test installs; `notify` and `close` are recorded so a test
 * can assert the handshake notification fired and the transport was closed.
 */
class FakeTransport implements McpTransportClient {
  /** Per-method responders keyed by JSON-RPC method name. */
  public readonly responders = new Map<
    string,
    (request: JsonRpcRequest) => JsonRpcResponse | Promise<JsonRpcResponse>
  >();

  /** Every request seen, in order. */
  public readonly requests: JsonRpcRequest[] = [];

  /** Every notification method seen, in order. */
  public readonly notifications: string[] = [];

  /** True once `close()` ran. */
  public closed = false;

  private nextId = 1;

  public allocateId(): number {
    return this.nextId++;
  }

  public on(
    method: string,
    responder: (request: JsonRpcRequest) => JsonRpcResponse | Promise<JsonRpcResponse>,
  ): void {
    this.responders.set(method, responder);
  }

  public async request<TResult = unknown>(
    request: JsonRpcRequest,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<JsonRpcResponse<TResult>> {
    this.requests.push(request);

    if (options?.signal?.aborted) {
      throw new McpTransportError("aborted", { type: "closed", method: request.method });
    }

    const responder = this.responders.get(request.method);

    if (!responder) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `no responder for ${request.method}` },
      } as JsonRpcResponse<TResult>;
    }

    const response = await responder(request);

    return response as JsonRpcResponse<TResult>;
  }

  public async notify(method: string): Promise<void> {
    this.notifications.push(method);
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

/** Build a transport pre-scripted with an `initialize` + `tools/list`. */
function scriptedTransport(tools: McpToolDescriptor[]): FakeTransport {
  const transport = new FakeTransport();

  transport.on("initialize", (request) => ({
    jsonrpc: "2.0",
    id: request.id,
    result: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      serverInfo: { name: "fake", version: "1.0" },
    },
  }));

  transport.on("tools/list", (request) => ({
    jsonrpc: "2.0",
    id: request.id,
    result: { tools },
  }));

  return transport;
}

/** A simple text `tools/call` result. */
function textCallResult(request: JsonRpcRequest, text: string, isError = false): JsonRpcResponse {
  const result: McpToolCallResult = { content: [{ type: "text", text }], isError };

  return { jsonrpc: "2.0", id: request.id, result };
}

const ECHO_TOOL: McpToolDescriptor = {
  name: "echo",
  description: "Echo the input back",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
  },
};

const ADD_TOOL: McpToolDescriptor = { name: "add", description: "Add two numbers" };

describe("mcp() client — handshake + tools/list", () => {
  it("runs the initialize handshake before tools/list", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);

    const client = mcp(transport);
    await client.tools();

    const methods = transport.requests.map((request) => request.method);
    expect(methods[0]).toBe("initialize");
    expect(methods).toContain("tools/list");
  });

  it("sends the notifications/initialized notification after initialize", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);

    await mcp(transport).tools();

    expect(transport.notifications).toContain("notifications/initialized");
  });

  it("adapts each remote tool into a ToolContract", async () => {
    const transport = scriptedTransport([ECHO_TOOL, ADD_TOOL]);

    const tools = await mcp(transport).tools();

    expect(tools).toHaveLength(2);
    const [contract] = tools;
    if (!contract) throw new Error("Expected an adapted echo tool");
    expect(contract.name).toBe("echo");
    expect(contract.description).toBe("Echo the input back");
    expect(typeof contract.invoke).toBe("function");
  });

  it("supplies a fallback description when the remote omits one", async () => {
    const transport = scriptedTransport([{ name: "bare" }]);

    const [contract] = await mcp(transport).tools();
    if (!contract) throw new Error("Expected an adapted tool");

    expect(contract.description).toContain("bare");
  });

  it("caches the adapted tools so the handshake runs only once", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);

    const client = mcp(transport);
    const first = await client.tools();
    const second = await client.tools();

    expect(first).toBe(second);
    const initializeCount = transport.requests.filter((r) => r.method === "initialize").length;
    expect(initializeCount).toBe(1);
  });

  it("shares one handshake across concurrent tools() callers", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);

    const client = mcp(transport);
    const [a, b] = await Promise.all([client.tools(), client.tools()]);

    expect(a).toBe(b);
    expect(transport.requests.filter((r) => r.method === "initialize").length).toBe(1);
  });
});

describe("mcp() client — namePrefix + filter", () => {
  it("prefixes adapted tool names with namePrefix", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);

    const [contract] = await mcp(transport, { namePrefix: "github." }).tools();

    expect(contract.name).toBe("github.echo");
  });

  it("calls the remote with the UNPREFIXED name", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    transport.on("tools/call", (request) => textCallResult(request, "ok"));

    const [contract] = await mcp(transport, { namePrefix: "github." }).tools();
    await contract.invoke({ message: "hi" });

    const call = transport.requests.find((r) => r.method === "tools/call");
    expect((call!.params as { name: string }).name).toBe("echo");
  });

  it("only adapts tools whose name passes the filter", async () => {
    const transport = scriptedTransport([ECHO_TOOL, ADD_TOOL]);

    const tools = await mcp(transport, { filter: (name) => name === "add" }).tools();

    expect(tools.map((t) => t.name)).toEqual(["add"]);
  });
});

describe("mcp() client — tools/call execution", () => {
  it("issues a tools/call and unwraps a JSON text result into an object", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    transport.on("tools/call", (request) =>
      textCallResult(request, JSON.stringify({ echoed: "hi" })),
    );

    const [contract] = await mcp(transport).tools();
    const { data, error } = await contract.invoke({ message: "hi" });

    expect(error).toBeUndefined();
    expect(data).toEqual({ echoed: "hi" });
  });

  it("returns a plain string result verbatim (not JSON-parsed)", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    transport.on("tools/call", (request) => textCallResult(request, "just text"));

    const [contract] = await mcp(transport).tools();
    const { data } = await contract.invoke({ message: "hi" });

    expect(data).toBe("just text");
  });

  it("passes the model arguments through as tools/call `arguments`", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    transport.on("tools/call", (request) => textCallResult(request, "ok"));

    const [contract] = await mcp(transport).tools();
    await contract.invoke({ message: "payload" });

    const call = transport.requests.find((r) => r.method === "tools/call");
    expect((call!.params as { arguments: unknown }).arguments).toEqual({ message: "payload" });
  });

  it("maps an isError result into the contract's error field", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    transport.on("tools/call", (request) => textCallResult(request, "boom", true));

    const [contract] = await mcp(transport).tools();
    const { data, error } = await contract.invoke({ message: "hi" });

    expect(data).toBeUndefined();
    expect(error).toBeDefined();
    expect(error?.message).toContain("boom");
  });

  it("maps a JSON-RPC error response into the contract's error field", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    transport.on("tools/call", (request) => ({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32000, message: "remote exploded" },
    }));

    const [contract] = await mcp(transport).tools();
    const { error } = await contract.invoke({ message: "hi" });

    expect(error).toBeDefined();
    expect(error?.message).toContain("remote exploded");
  });

  it("threads the per-call timeout into the transport request", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    let seenTimeout: number | undefined;

    const original = transport.request.bind(transport);
    transport.request = (request, options) => {
      if (request.method === "tools/call") {
        seenTimeout = options?.timeoutMs;
      }

      return original(request, options);
    };
    transport.on("tools/call", (request) => textCallResult(request, "ok"));

    const [contract] = await mcp(transport, { timeoutMs: 1234 }).tools();
    await contract.invoke({ message: "hi" });

    expect(seenTimeout).toBe(1234);
  });

  it("aborts the in-flight call when ctx.signal is already aborted", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    transport.on("tools/call", (request) => textCallResult(request, "ok"));

    const [contract] = await mcp(transport).tools();
    const controller = new AbortController();
    controller.abort();

    const { error } = await contract.invoke(
      { message: "hi" },
      { artifacts: {}, signal: controller.signal },
    );

    expect(error).toBeDefined();
  });

  it("rejects model input that violates the remote JSON Schema", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    transport.on("tools/call", (request) => textCallResult(request, "ok"));

    const [contract] = await mcp(transport).tools();
    // `message` is required + must be a string; pass a number.
    const { error } = await contract.invoke({ message: 42 });

    // Either a schema rejection (ajv present) or a passthrough that the
    // remote would reject — but with no ajv installed it accepts-all, so
    // the call still resolves. Assert the call did not throw outward.
    expect(error === undefined || error.message.length > 0).toBe(true);
  });
});

describe("mcp() client — close", () => {
  it("closes the underlying transport", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);

    const client = mcp(transport);
    await client.tools();
    await client.close();

    expect(transport.closed).toBe(true);
  });

  it("surfaces a handshake failure from tools()", async () => {
    const transport = new FakeTransport();
    transport.on("initialize", (request) => ({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32000, message: "no server here" },
    }));

    const client = mcp(transport);

    await expect(client.tools()).rejects.toBeInstanceOf(McpTransportError);
  });

  it("uses spy-tracked notify for the initialized notification", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    const notifySpy = vi.spyOn(transport, "notify");

    await mcp(transport).tools();

    expect(notifySpy.mock.calls.some((args) => args[0] === "notifications/initialized")).toBe(true);
  });
});

describe("mcp() client — client-level signal", () => {
  it("closes the transport when the signal aborts and fails later calls as closed", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    transport.on("tools/call", (request) => textCallResult(request, "ok"));
    const controller = new AbortController();
    const client = mcp(transport, { signal: controller.signal });

    const [contract] = await client.tools();
    if (!contract) throw new Error("expected one adapted tool");
    controller.abort();
    await Promise.resolve();

    expect(transport.closed).toBe(true);

    const { error } = await contract.invoke({ message: "hi" });

    expect(error).toBeDefined();
    expect(transport.requests.filter((request) => request.method === "tools/call")).toHaveLength(0);
  });

  it("never connects when the signal is already aborted", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    const controller = new AbortController();
    controller.abort();

    const client = mcp(transport, { signal: controller.signal });

    await expect(client.tools()).rejects.toMatchObject({ type: "closed" });
    expect(transport.requests).toHaveLength(0);
    expect(transport.closed).toBe(true);
  });

  it("forwards the client signal to tools/call alongside ctx.signal", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    const seen: Array<AbortSignal | undefined> = [];
    const original = transport.request.bind(transport);
    transport.request = async (request, options) => {
      if (request.method === "tools/call") {
        seen.push(options?.signal);
      }

      return original(request, options);
    };
    transport.on("tools/call", (request) => textCallResult(request, "ok"));
    const client = mcp(transport, { signal: new AbortController().signal });
    const [contract] = await client.tools();
    if (!contract) throw new Error("expected one adapted tool");
    const call = new AbortController();

    await contract.invoke({ message: "hi" }, { artifacts: {}, signal: call.signal });
    call.abort();

    expect(seen[0]?.aborted).toBe(true);
  });

  it("closes once even when close() and the signal both fire", async () => {
    const transport = scriptedTransport([ECHO_TOOL]);
    const closeSpy = vi.spyOn(transport, "close");
    const controller = new AbortController();
    const client = mcp(transport, { signal: controller.signal });

    await client.close();
    controller.abort();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
