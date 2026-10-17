import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttp2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import type { Message } from "../contracts/conversation-message.type";
import type { ModelContract } from "../contracts/model.contract";

/** One model call the contract exercises. */
export type ModelSignalContractMethod = "complete" | "stream";

/**
 * Options for {@link verifyModelSignalContract}.
 */
export type ModelSignalContractOptions = {
  /**
   * Build the model under test, pointed at `endpoint.baseURL` — a local
   * server that accepts every request and never answers. Pass the URL
   * through the adapter's base-URL option (`baseURL`, `host`, `endpoint`,
   * `httpOptions.baseUrl`, …) and any dummy credentials it needs.
   */
  createModel: (endpoint: { baseURL: string }) => ModelContract;
  /** Calls to check. Default: both `complete` and `stream`. */
  methods?: ModelSignalContractMethod[];
  /**
   * Wire protocol the local server speaks. `"http1"` (default) suits
   * fetch-based SDKs; `"http2"` is cleartext HTTP/2 with prior knowledge,
   * for clients whose default handler speaks HTTP/2 (the AWS SDK's
   * Bedrock Runtime client).
   */
  protocol?: "http1" | "http2";
  /** Longest wait, in ms, for each step (request arrival, rejection, disconnect). Default `5000`. */
  timeoutMs?: number;
  /** Conversation sent on every call. Default: one short user message. */
  messages?: Message[];
};

/** What one contract check observed. */
export type ModelSignalContractCheck = {
  method: ModelSignalContractMethod;
  /** `"before-call"`: the signal was aborted before the call; `"in-flight"`: aborted while the request was open. */
  scenario: "before-call" | "in-flight";
  /** Requests that reached the server during this check. */
  requests: number;
  /** The error the call rejected with. */
  error: unknown;
};

/** Result of a passing {@link verifyModelSignalContract} run. */
export type ModelSignalContractReport = {
  checks: ModelSignalContractCheck[];
};

/** One request held open by the local server; `closed` settles when the client disconnects. */
type HeldRequest = { closed: Promise<void> };

/** A server that accepts every request, never answers, and reports disconnects. */
type HangingServer = {
  baseURL: string;
  /** Resolves with the next request that arrives (or one that already arrived and was not yet taken). */
  nextRequest: () => Promise<HeldRequest>;
  /** Requests received since the last `reset()`. */
  count: () => number;
  reset: () => void;
  close: () => Promise<void>;
};

const DEFAULT_MESSAGES: Message[] = [{ role: "user", content: "ping" }];

/**
 * Verify that a model adapter honours `ModelCallOptions.signal` — the
 * cancellation half of the `ModelContract`.
 *
 * Starts a local server (an ephemeral `127.0.0.1` port) that accepts every
 * request and never answers, builds the model with
 * `createModel({ baseURL })`, and for each method checks that:
 *
 * 1. **before-call** — a call made with an already-aborted signal rejects,
 *    and any request it sent is closed;
 * 2. **in-flight** — aborting while the request is open rejects the call
 *    promptly *and* closes the HTTP request (the server sees the client
 *    disconnect), so the provider stops generating and billing.
 *
 * Throws an `Error` naming the failed check; resolves with what each check
 * observed. It has no test-runner dependency, so it runs under any runner:
 *
 * @example
 * import { verifyModelSignalContract } from "@warlock.js/ai";
 * import { OpenAISDK } from "@warlock.js/ai-openai";
 *
 * it("honours the abort signal", async () => {
 *   await verifyModelSignalContract({
 *     createModel: ({ baseURL }) =>
 *       new OpenAISDK({ apiKey: "test", baseURL, maxRetries: 0 }).model({ name: "gpt-4o-mini" }),
 *   });
 * });
 */
export async function verifyModelSignalContract(
  options: ModelSignalContractOptions,
): Promise<ModelSignalContractReport> {
  const methods = options.methods ?? ["complete", "stream"];
  const timeoutMs = options.timeoutMs ?? 5_000;
  const messages = options.messages ?? DEFAULT_MESSAGES;
  const server = await startHangingServer(options.protocol ?? "http1");
  const checks: ModelSignalContractCheck[] = [];

  try {
    const model = options.createModel({ baseURL: server.baseURL });

    for (const method of methods) {
      checks.push(await checkBeforeCall(model, method, messages, server, timeoutMs));
      checks.push(await checkInFlight(model, method, messages, server, timeoutMs));
    }
  } finally {
    await server.close();
  }

  return { checks };
}

/** Run one model call to completion — draining the stream for `stream`. */
async function runCall(
  model: ModelContract,
  method: ModelSignalContractMethod,
  messages: Message[],
  signal: AbortSignal,
): Promise<void> {
  if (method === "complete") {
    await model.complete(messages, { signal });

    return;
  }

  for await (const _chunk of model.stream(messages, { signal })) {
    // Drain: the contract only cares whether the stream ends in a rejection.
  }
}

/** The settled outcome of a call, or `"pending"` when it is still running at the deadline. */
async function settleWithin(
  call: Promise<void>,
  timeoutMs: number,
): Promise<{ state: "resolved" } | { state: "rejected"; error: unknown } | { state: "pending" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ state: "pending" }>((resolve) => {
    timer = setTimeout(() => resolve({ state: "pending" }), timeoutMs);
  });

  try {
    return await Promise.race([
      call.then(
        () => ({ state: "resolved" as const }),
        (error: unknown) => ({ state: "rejected" as const, error }),
      ),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve `true` once `promise` settles, `false` at the deadline. */
async function within(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function fail(model: ModelContract, method: string, scenario: string, problem: string): never {
  throw new Error(
    `Signal contract failed for ${model.provider}/${model.name} ${method}() [${scenario}]: ${problem}`,
  );
}

async function checkBeforeCall(
  model: ModelContract,
  method: ModelSignalContractMethod,
  messages: Message[],
  server: HangingServer,
  timeoutMs: number,
): Promise<ModelSignalContractCheck> {
  server.reset();

  const controller = new AbortController();

  controller.abort();

  const call = runCall(model, method, messages, controller.signal);
  // Attach a handler at once so a fast rejection is never reported as unhandled.
  call.catch(() => undefined);

  const outcome = await settleWithin(call, timeoutMs);

  if (outcome.state === "resolved") {
    fail(
      model,
      method,
      "before-call",
      "the call succeeded although its signal was already aborted",
    );
  }

  if (outcome.state === "pending") {
    fail(model, method, "before-call", `the call did not reject within ${timeoutMs} ms`);
  }

  // A request sent despite the aborted signal may still be in transit.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const requests = server.count();

  for (let index = 0; index < requests; index++) {
    const held = await server.nextRequest();

    if (!(await within(held.closed, timeoutMs))) {
      fail(
        model,
        method,
        "before-call",
        "a request was sent and left open after the call rejected",
      );
    }
  }

  return { method, scenario: "before-call", requests, error: outcome.error };
}

async function checkInFlight(
  model: ModelContract,
  method: ModelSignalContractMethod,
  messages: Message[],
  server: HangingServer,
  timeoutMs: number,
): Promise<ModelSignalContractCheck> {
  server.reset();

  const controller = new AbortController();
  const call = runCall(model, method, messages, controller.signal);
  call.catch(() => undefined);

  const arrival = server.nextRequest();

  if (!(await within(arrival, timeoutMs))) {
    const early = await settleWithin(call, 0);

    fail(
      model,
      method,
      "in-flight",
      early.state === "rejected"
        ? `the call failed before reaching ${server.baseURL}: ${String(early.error)}`
        : `no request reached ${server.baseURL} within ${timeoutMs} ms — is createModel() using the baseURL?`,
    );
  }

  const held = await arrival;

  controller.abort();

  const outcome = await settleWithin(call, timeoutMs);

  if (outcome.state === "resolved") {
    fail(model, method, "in-flight", "the call resolved after its signal aborted");
  }

  if (outcome.state === "pending") {
    fail(model, method, "in-flight", `the call did not reject within ${timeoutMs} ms of the abort`);
  }

  if (!(await within(held.closed, timeoutMs))) {
    fail(
      model,
      method,
      "in-flight",
      "the call rejected but the HTTP request stayed open — the signal never reached the transport",
    );
  }

  return { method, scenario: "in-flight", requests: server.count(), error: outcome.error };
}

/**
 * Track held requests: arrivals are queued until a check takes them, and
 * each one exposes a promise that settles when the client disconnects.
 */
function requestQueue() {
  let received: HeldRequest[] = [];
  let waiters: Array<(held: HeldRequest) => void> = [];
  let total = 0;

  return {
    add(onClose: (listener: () => void) => void): void {
      const held: HeldRequest = { closed: new Promise<void>((resolve) => onClose(resolve)) };

      total++;

      const waiter = waiters.shift();

      if (waiter) {
        waiter(held);
      } else {
        received.push(held);
      }
    },
    next(): Promise<HeldRequest> {
      const held = received.shift();

      return held ? Promise.resolve(held) : new Promise((resolve) => waiters.push(resolve));
    },
    count: () => total,
    reset(): void {
      received = [];
      waiters = [];
      total = 0;
    },
  };
}

async function startHangingServer(protocol: "http1" | "http2"): Promise<HangingServer> {
  const queue = requestQueue();

  if (protocol === "http2") {
    const server = createHttp2Server();
    const sessions = new Set<ServerHttp2Session>();

    server.on("session", (session) => {
      sessions.add(session);
      session.once("close", () => sessions.delete(session));
    });
    server.on("stream", (stream) => {
      stream.resume();
      queue.add((listener) => stream.once("close", listener));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const { port } = server.address() as AddressInfo;

    return {
      baseURL: `http://127.0.0.1:${port}`,
      nextRequest: queue.next,
      count: queue.count,
      reset: queue.reset,
      close: () =>
        new Promise<void>((resolve) => {
          for (const session of sessions) session.destroy();
          server.close(() => resolve());
        }),
    };
  }

  const server = createHttpServer((request: IncomingMessage, response: ServerResponse) => {
    request.resume();
    queue.add((listener) => response.once("close", listener));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address() as AddressInfo;

  return {
    baseURL: `http://127.0.0.1:${port}`,
    nextRequest: queue.next,
    count: queue.count,
    reset: queue.reset,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
