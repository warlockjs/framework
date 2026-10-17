import { describe, expect, it } from "vitest";
import type { Message } from "../contracts/conversation-message.type";
import type {
  ModelCallOptions,
  ModelContract,
  ModelResponse,
  ModelStreamChunk,
} from "../contracts/model.contract";
import { verifyModelSignalContract } from "./model-signal-contract";

/**
 * A minimal fetch-backed model. `forwardSignal: false` reproduces an
 * adapter that ignores `ModelCallOptions.signal`, and `raceSignal` one that
 * rejects on abort without cancelling the request underneath.
 */
function fetchModel(
  baseURL: string,
  behaviour: { forwardSignal: boolean; raceSignal?: boolean },
): ModelContract {
  const send = async (options?: ModelCallOptions): Promise<Response> => {
    const request = fetch(`${baseURL}/v1/chat`, {
      method: "POST",
      body: JSON.stringify({ model: "fake" }),
      ...(behaviour.forwardSignal && options?.signal ? { signal: options.signal } : {}),
    });

    if (!behaviour.raceSignal || !options?.signal) {
      return request;
    }

    const signal = options.signal;

    return Promise.race([
      request,
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error("aborted"));
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    ]);
  };

  return {
    name: "fake",
    provider: "fake",
    async complete(_messages: Message[], options?: ModelCallOptions): Promise<ModelResponse> {
      await send(options);

      return { content: "", finishReason: "stop", usage: { input: 0, output: 0, total: 0 } };
    },
    async *stream(
      _messages: Message[],
      options?: ModelCallOptions,
    ): AsyncIterable<ModelStreamChunk> {
      await send(options);

      yield { type: "done", finishReason: "stop", usage: { input: 0, output: 0, total: 0 } };
    },
  };
}

describe("verifyModelSignalContract", () => {
  it("passes an adapter that forwards the signal to its transport", async () => {
    const report = await verifyModelSignalContract({
      createModel: ({ baseURL }) => fetchModel(baseURL, { forwardSignal: true }),
    });

    expect(report.checks.map((check) => `${check.method}:${check.scenario}`)).toEqual([
      "complete:before-call",
      "complete:in-flight",
      "stream:before-call",
      "stream:in-flight",
    ]);
    expect(report.checks.every((check) => check.error !== undefined)).toBe(true);
    // fetch with an aborted signal never sends the request.
    expect(report.checks[0]?.requests).toBe(0);
    expect(report.checks[1]?.requests).toBe(1);
  });

  it("fails an adapter that ignores the signal", async () => {
    await expect(
      verifyModelSignalContract({
        createModel: ({ baseURL }) => fetchModel(baseURL, { forwardSignal: false }),
        methods: ["complete"],
        timeoutMs: 300,
      }),
    ).rejects.toThrow(/fake\/fake complete\(\) \[before-call\]: the call did not reject/);
  });

  it("fails an adapter that rejects on abort but leaves the request open", async () => {
    await expect(
      verifyModelSignalContract({
        createModel: ({ baseURL }) =>
          fetchModel(baseURL, { forwardSignal: false, raceSignal: true }),
        methods: ["stream"],
        timeoutMs: 300,
      }),
    ).rejects.toThrow(
      /\[before-call\]: a request was sent and left open|\[in-flight\]: the call rejected but the HTTP request stayed open/,
    );
  });

  it("explains a model that never reaches the base URL", async () => {
    await expect(
      verifyModelSignalContract({
        createModel: () => fetchModel("http://127.0.0.1:9", { forwardSignal: true }),
        methods: ["complete"],
        timeoutMs: 300,
      }),
    ).rejects.toThrow(/\[in-flight\]: the call failed before reaching/);
  });

  it("serves cleartext HTTP/2 when asked", async () => {
    const { connect } = await import("node:http2");
    const report = await verifyModelSignalContract({
      protocol: "http2",
      methods: ["complete"],
      createModel: ({ baseURL }) => ({
        name: "h2",
        provider: "fake",
        async complete(_messages, options) {
          const signal = options?.signal;

          if (signal?.aborted) {
            throw new Error("aborted");
          }

          const session = connect(baseURL);

          session.on("error", () => undefined);

          try {
            await new Promise<void>((resolve, reject) => {
              const stream = session.request({ ":method": "POST", ":path": "/" });

              stream.on("error", () => undefined);
              signal?.addEventListener(
                "abort",
                () => {
                  stream.close();
                  reject(new Error("aborted"));
                },
                { once: true },
              );
              stream.on("response", () => resolve());
              stream.end("{}");
            });
          } finally {
            session.close();
          }

          return { content: "", finishReason: "stop", usage: { input: 0, output: 0, total: 0 } };
        },
        async *stream() {
          yield { type: "done", finishReason: "stop", usage: { input: 0, output: 0, total: 0 } };
        },
      }),
    });

    expect(report.checks.map((check) => check.scenario)).toEqual(["before-call", "in-flight"]);
  });
});
