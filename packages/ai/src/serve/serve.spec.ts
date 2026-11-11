import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderTimeoutError } from "../errors";
import { ServeHttpError } from "./serve-http-error";
import { encodeSSE } from "./sse";
import { serve, type ServableExecutable } from "./serve";
import { streamToSSE, type StreamLike } from "./stream-to-sse";

describe("encodeSSE", () => {
  it("formats an event + JSON data frame", () => {
    expect(encodeSSE({ event: "delta", data: { d: "Hi" } })).toBe(
      'event: delta\ndata: {"d":"Hi"}\n\n',
    );
  });

  it("splits multi-line data across data: lines", () => {
    expect(encodeSSE({ data: "a\nb" })).toBe("data: a\ndata: b\n\n");
  });
});

/** Build a StreamLike from a fixed event list + result. */
function fakeStream(
  events: Array<{ type: string; [field: string]: unknown }>,
  result: unknown,
): StreamLike<{ type: string }, unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
    result: Promise.resolve(result),
  };
}

describe("streamToSSE (A3)", () => {
  it("emits a frame per event, then result, then [DONE]", async () => {
    const frames: string[] = [];
    for await (const frame of streamToSSE(
      fakeStream([{ type: "agent.trip.streaming" }, { type: "agent.completed" }], { ok: true }),
    )) {
      frames.push(frame);
    }

    expect(frames[0]).toContain("event: agent.trip.streaming");
    expect(frames[1]).toContain("event: agent.completed");
    expect(frames[2]).toContain("event: result");
    expect(frames.at(-1)).toBe("data: [DONE]\n\n");
  });
});

/** Minimal writable response capturing status, headers, and body. */
function fakeRes() {
  const res = new EventEmitter() as unknown as ServerResponse & {
    status: number;
    headers: Record<string, string>;
    body: string;
  };
  res.status = 0;
  res.headers = {};
  res.body = "";
  let headersSent = false;
  let writableEnded = false;
  Object.defineProperty(res, "headersSent", { get: () => headersSent });
  Object.defineProperty(res, "writableEnded", { get: () => writableEnded });
  res.writeHead = ((status: number, headers?: Record<string, string>) => {
    res.status = status;
    headersSent = true;
    Object.assign(res.headers, headers ?? {});
    return res;
  }) as typeof res.writeHead;
  res.write = ((chunk: string) => {
    res.body += chunk;
    return true;
  }) as ServerResponse["write"];
  res.end = ((chunk?: string) => {
    if (chunk) res.body += chunk;
    writableEnded = true;
    return res;
  }) as typeof res.end;
  return res;
}

/** Drive a POST request with a JSON body through a handler. */
function post(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const req = new EventEmitter() as unknown as IncomingMessage;
  req.method = "POST";
  req.headers = headers;
  req.resume = (() => req) as IncomingMessage["resume"];
  const res = fakeRes();
  handler(req, res);
  // Like a paused IncomingMessage, deliver the body once listeners can attach.
  setImmediate(() => {
    req.emit("data", JSON.stringify(body));
    req.emit("end");
  });
  return res;
}

const mockAgent: ServableExecutable = {
  stream(input: unknown) {
    return fakeStream(
      [{ type: "agent.trip.streaming", delta: String(input) }, { type: "agent.completed" }],
      { text: `echo: ${String(input)}` },
    );
  },
};

describe("serve (A3)", () => {
  it("streams an executable run as SSE over POST", async () => {
    const res = post(serve(mockAgent), { input: "hello" });
    await new Promise((r) => setTimeout(r, 10));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("event: agent.trip.streaming");
    expect(res.body).toContain('"text":"echo: hello"');
    expect(res.body.trimEnd().endsWith("[DONE]")).toBe(true);
  });

  it("rejects a non-POST method with 405", () => {
    const handler = serve(mockAgent);
    const req = new EventEmitter() as unknown as IncomingMessage;
    req.method = "GET";
    req.headers = {};
    const res = fakeRes();
    handler(req, res);
    expect(res.status).toBe(405);
  });

  it("requires the bearer token when authToken is set", async () => {
    const res = post(serve(mockAgent, { authToken: "t" }), { input: "x" });
    await new Promise((r) => setTimeout(r, 10));
    expect(res.status).toBe(401);
  });

  it("accepts the request with a valid bearer token", async () => {
    const res = post(
      serve(mockAgent, { authToken: "t" }),
      { input: "x" },
      {
        authorization: "Bearer t",
      },
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(res.status).toBe(200);
  });

  it("ignores client session state and supplies only server-owned state", async () => {
    let receivedOptions: Record<string, unknown> | undefined;
    const executable: ServableExecutable = {
      stream(_input, streamOptions) {
        receivedOptions = streamOptions;
        return fakeStream([], { ok: true });
      },
    };

    post(
      serve(executable, {
        session: {
          createId: () => "server-session",
          loadHistory: () => [{ role: "user", content: "trusted" }],
        },
      }),
      { input: "hello", sessionId: "client-session", history: ["untrusted"] },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(receivedOptions).toMatchObject({
      sessionId: "server-session",
      history: [{ role: "user", content: "trusted" }],
    });
    expect(receivedOptions?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects request bodies over the configured byte limit", async () => {
    const res = post(serve(mockAgent, { maxBodyBytes: 10 }), { input: "too large" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(res.status).toBe(413);
    expect(res.body).toContain("payload_too_large");
  });

  it("uses a 1 MiB default request-body limit", async () => {
    const res = post(serve(mockAgent), { input: "x".repeat(1024 * 1024) });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(res.status).toBe(413);
    expect(res.body).toContain("payload_too_large");
  });

  it("aborts the stream signal when the response closes before completion", async () => {
    let receivedSignal: AbortSignal | undefined;
    const executable: ServableExecutable = {
      stream(_input, streamOptions) {
        receivedSignal = streamOptions?.signal as AbortSignal;
        return {
          // oxlint-disable-next-line eslint/require-yield -- This cancellation fixture intentionally waits for abort and emits no stream items.
          async *[Symbol.asyncIterator]() {
            await new Promise<void>((resolve) => {
              receivedSignal?.addEventListener("abort", () => resolve(), { once: true });
            });
          },
        };
      },
    };
    const req = new EventEmitter() as unknown as IncomingMessage;
    req.method = "POST";
    req.headers = {};
    const res = fakeRes();
    serve(executable)(req, res);
    req.emit("data", JSON.stringify({ input: "hello" }));
    req.emit("end");
    await new Promise((resolve) => setTimeout(resolve, 0));
    res.emit("close");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(receivedSignal?.aborted).toBe(true);
  });
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** A run whose events and result carry internals a client must not see. */
const leakyAgent: ServableExecutable = {
  stream() {
    return fakeStream(
      [
        { type: "agent.starting", input: "hello" },
        { type: "agent.trip.streaming", delta: "Hi", tripIndex: 0 },
        { type: "agent.trip.reasoning", delta: "thinking about SECRET-REASONING", tripIndex: 0 },
        { type: "agent.tool.calling", tool: { name: "lookup" }, input: { id: 7 } },
        {
          type: "agent.tool.called",
          toolCall: { name: "lookup", output: { secret: "SECRET-TOOL-ROW" } },
        },
        { type: "agent.completed" },
      ] as Array<{ type: string }>,
      {
        type: "agent",
        text: "Hi",
        data: "Hi",
        usage: { input: 1, output: 1, total: 2 },
        report: { systemPrompt: "SECRET-SYSTEM-PROMPT", trips: [] },
      },
    );
  },
};

describe("serve: client-safe stream by default", () => {
  it("sends text deltas and the answer, not the system prompt, tool data or reasoning", async () => {
    const res = post(serve(leakyAgent), { input: "hello" });
    await settle();

    expect(res.status).toBe(200);
    expect(res.body).toContain('data: {"type":"agent.trip.streaming","delta":"Hi"}');
    expect(res.body).toContain('data: {"text":"Hi","data":"Hi"}');
    expect(res.body).not.toContain("SECRET-SYSTEM-PROMPT");
    expect(res.body).not.toContain("SECRET-TOOL-ROW");
    expect(res.body).not.toContain("SECRET-REASONING");
    expect(res.body).not.toContain("agent.tool.calling");
  });

  it('restores the full trace with events: "all" and an identity toResult', async () => {
    const res = post(serve(leakyAgent, { events: "all", toResult: (result) => result }), {
      input: "hello",
    });
    await settle();

    expect(res.body).toContain("SECRET-SYSTEM-PROMPT");
    expect(res.body).toContain("SECRET-TOOL-ROW");
    expect(res.body).toContain("SECRET-REASONING");
  });

  it("sends only the listed event types with an events array", async () => {
    const res = post(serve(leakyAgent, { events: ["agent.tool.calling"] }), { input: "hello" });
    await settle();

    expect(res.body).toContain("event: agent.tool.calling");
    expect(res.body).not.toContain("event: agent.trip.streaming");
  });

  it("maps a run error to its code, a fixed message and a reference", async () => {
    const error = new ProviderTimeoutError("connect ETIMEDOUT 10.0.3.7:443", {
      context: { host: "10.0.3.7" },
    });
    const executable: ServableExecutable = {
      stream() {
        return fakeStream([{ type: "agent.error", error } as { type: string }], {
          error,
          usage: { input: 0, output: 0, total: 0 },
        });
      },
    };
    const errorLog = vi.spyOn(log, "error").mockImplementation(() => undefined as never);

    const res = post(serve(executable), { input: "hello" });
    await settle();

    expect(res.body).not.toContain("10.0.3.7");
    expect(res.body).toContain('"code":"PROVIDER_TIMEOUT"');
    const references = [...res.body.matchAll(/"reference":"([^"]+)"/g)].map((match) => match[1]);
    expect(references).toHaveLength(2);
    expect(new Set(references).size).toBe(1);
    // One server log line per error, carrying the reference.
    expect(errorLog).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });
});

describe("serve: request failures never crash the process", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers 500 JSON when session.createId throws", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    vi.spyOn(log, "error").mockImplementation(() => undefined as never);

    const res = post(
      serve(mockAgent, {
        session: {
          createId: () => {
            throw new Error("no session cookie");
          },
        },
      }),
      { input: "hello" },
    );
    await settle();
    process.off("unhandledRejection", onRejection);

    expect(res.status).toBe(500);
    expect(res.body).toBe('{"error":"internal_error"}');
    expect(rejections).toEqual([]);
  });

  it("answers the status of a ServeHttpError thrown from a callback", async () => {
    const res = post(
      serve(mockAgent, {
        session: {
          createId: async () => {
            throw new ServeHttpError(401, "unauthorized");
          },
        },
      }),
      { input: "hello" },
    );
    await settle();

    expect(res.status).toBe(401);
    expect(res.body).toBe('{"error":"unauthorized"}');
  });

  it("awaits an async loadHistory and passes the loaded array to stream()", async () => {
    let received: unknown;
    const executable: ServableExecutable = {
      stream(_input, streamOptions) {
        received = streamOptions?.history;
        return fakeStream([], { text: "ok" });
      },
    };

    post(
      serve(executable, {
        session: {
          createId: async () => "s-1",
          loadHistory: async ({ sessionId }) => [{ role: "user", content: `from ${sessionId}` }],
        },
      }),
      { input: "hello" },
    );
    await settle();

    expect(received).toEqual([{ role: "user", content: "from s-1" }]);
  });
});

describe("serve: input validation", () => {
  it("refuses a non-string input with 400 invalid_input", async () => {
    let called = false;
    const executable: ServableExecutable = {
      stream() {
        called = true;
        return fakeStream([], {});
      },
    };

    const res = post(serve(executable), {
      input: [{ type: "image", source: { url: "https://example.com/a.png" } }],
    });
    await settle();

    expect(res.status).toBe(400);
    expect(res.body).toBe('{"error":"invalid_input"}');
    expect(called).toBe(false);
  });

  it("refuses input longer than maxInputChars with 413", async () => {
    const res = post(serve(mockAgent, { maxInputChars: 5 }), { input: "too long" });
    await settle();

    expect(res.status).toBe(413);
    expect(res.body).toBe('{"error":"input_too_large"}');
  });

  it("lets a custom toInput accept a structured body", async () => {
    let received: unknown;
    const executable: ServableExecutable<{ question: string }> = {
      stream(input) {
        received = input;
        return fakeStream([], {});
      },
    };

    post(serve(executable, { toInput: (body) => ({ question: String(body.q) }) }), { q: "why" });
    await settle();

    expect(received).toEqual({ question: "why" });
  });
});

describe("serve: access control", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("answers 401 when authorize returns false", async () => {
    const res = post(serve(mockAgent, { authorize: async () => false }), { input: "x" });
    await settle();

    expect(res.status).toBe(401);
  });

  it("runs the request when authorize returns true", async () => {
    const res = post(serve(mockAgent, { authorize: () => true }), { input: "x" });
    await settle();

    expect(res.status).toBe(200);
  });

  it("answers 503 busy over maxConcurrent", async () => {
    let release = () => {};
    const executable: ServableExecutable = {
      stream() {
        return {
          // oxlint-disable-next-line eslint/require-yield -- This fixture holds the run open and emits no stream items.
          async *[Symbol.asyncIterator]() {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          },
        };
      },
    };
    const handler = serve(executable, { maxConcurrent: 1 });

    const first = post(handler, { input: "a" });
    await settle();
    const second = post(handler, { input: "b" });
    await settle();

    expect(first.status).toBe(200);
    expect(second.status).toBe(503);
    expect(second.body).toBe('{"error":"busy"}');
    release();
  });

  it("warns once in production when no auth option is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined as never);

    serve(mockAgent, { public: true });
    serve(mockAgent, { authToken: "t" });
    expect(warn).not.toHaveBeenCalled();

    serve(mockAgent);
    serve(mockAgent);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[2])).toContain("authToken");
  });
});
