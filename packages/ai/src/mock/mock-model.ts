import type { Message } from "../contracts/conversation-message.type";
import type { FinishReason } from "../contracts/finish-reason.type";
import type {
  ModelCallOptions,
  ModelCapabilities,
  ModelContract,
  ModelResponse,
  ModelStreamChunk,
} from "../contracts/model.contract";
import type { ModelPricing } from "../contracts/result/model-pricing.type";
import { resolveStreamChunks } from "../model/stream-chunks";
import type { MockModelResponse } from "./mock-config.type";

type RecordedCall = {
  messages: Message[];
  options?: ModelCallOptions;
};

/**
 * Deterministic in-memory `ModelContract` implementation for tests.
 *
 * **Role.** Stands in for a real provider model so agent/workflow/supervisor
 * tests can assert behavior without hitting the network, spending tokens, or
 * depending on non-deterministic LLM output.
 *
 * **Responsibility.**
 * - Owns: a scripted queue of `MockModelResponse` entries, a call-history
 *   log for assertions, and the index pointer that advances through the
 *   queue on each `complete()` / `stream()` call.
 * - Does NOT own: any real inference, tokenization, or network I/O — when
 *   the queue is exhausted, the final entry is reused so tests never crash
 *   on accidental over-consumption.
 *
 * Honours `ModelCallOptions.signal` like a real adapter: an already-aborted
 * signal rejects the call before anything is returned, an abort during a
 * scripted `delay` rejects immediately, and a stream stops between chunks.
 * The rejection is the signal's `reason` when it is an `Error` (an
 * `AbortError` `DOMException` for a bare `controller.abort()`).
 *
 * A scripted entry with non-empty `toolCalls` and no `finishReason`
 * finishes with `"tool_calls"` (otherwise `"stop"`), so the agent runs the
 * scripted tools without the script repeating the finish reason.
 *
 * Every AI-related test in this repo uses `MockSDK` / `MockModel` — real
 * provider APIs are never hit from the test suite (see §6 of code-style.md).
 *
 * @example
 * const model = new MockModel("mock-gpt", [
 *   { content: "Hello!", finishReason: "stop" },
 *   { content: "Second turn.", finishReason: "stop" },
 * ]);
 *
 * const first = await model.complete([{ role: "user", content: "hi" }]);
 * expect(first.content).toBe("Hello!");
 * expect(model.callCount).toBe(1);
 */
export class MockModel implements ModelContract {
  public readonly provider = "mock";
  public readonly capabilities?: ModelCapabilities;

  private responseIndex = 0;
  private calls: RecordedCall[] = [];

  public constructor(
    public readonly name: string,
    private readonly responses: MockModelResponse[],
    capabilities?: ModelCapabilities,
    public readonly pricing?: ModelPricing,
  ) {
    this.capabilities = capabilities;
  }

  /**
   * Full history of calls made to this model. Each entry is the exact
   * `{ messages, options }` pair that was passed — useful for asserting
   * that an agent built the right prompt or forwarded the right tool list.
   */
  public get callHistory(): RecordedCall[] {
    return this.calls;
  }

  /**
   * Number of times `complete()` or `stream()` has been invoked. Convenient
   * shorthand for `callHistory.length` in assertions.
   */
  public get callCount(): number {
    return this.calls.length;
  }

  /**
   * Advance the scripted response queue by one and return the entry at the
   * current pointer. If the queue is exhausted, the final scripted entry is
   * returned repeatedly so over-consumption in tests produces predictable
   * output instead of `undefined`.
   */
  private nextResponse(): MockModelResponse {
    const response = this.responses[Math.min(this.responseIndex, this.responses.length - 1)];

    this.responseIndex++;

    return response ?? { content: "Mock response", finishReason: "stop" };
  }

  /**
   * Convert a scripted `MockModelResponse` into a full `ModelResponse` with
   * synthesized usage numbers when the script didn't supply them. Input
   * usage is a fixed estimate; output usage is derived from content length.
   */
  private buildResponse(mock: MockModelResponse): ModelResponse {
    const estimatedInput = 10;
    const estimatedOutput = Math.ceil(mock.content.length / 4);

    return {
      content: mock.content,
      finishReason: mock.finishReason ?? inferFinishReason(mock),
      usage: {
        input: mock.usage?.input ?? estimatedInput,
        output: mock.usage?.output ?? estimatedOutput,
        total: (mock.usage?.input ?? estimatedInput) + (mock.usage?.output ?? estimatedOutput),
        ...(mock.usage?.cachedTokens !== undefined
          ? { cachedTokens: mock.usage.cachedTokens }
          : {}),
      },
      toolCalls: mock.toolCalls,
      ...(mock.blocks ? { blocks: mock.blocks } : {}),
    };
  }

  /**
   * Record the call, optionally delay (to simulate latency), and either
   * throw the scripted error or return the scripted response. Mirrors the
   * real provider's `complete()` contract so agents cannot tell the
   * difference at runtime.
   */
  public async complete(messages: Message[], options?: ModelCallOptions): Promise<ModelResponse> {
    this.calls.push({ messages, options });

    const mock = this.nextResponse();

    await waitFor(mock.delay, options?.signal);

    if (mock.error) {
      throw mock.error;
    }

    return this.buildResponse(mock);
  }

  /**
   * Record the call, optionally delay, then emit the scripted response as a
   * sequence of stream chunks: the scripted `deltas` when the entry
   * supplies them, otherwise content split word-by-word, as `delta`
   * chunks, each scripted tool call as a `tool-call` chunk, and finally a
   * `done` chunk with finish reason + usage. With `streamChunks` opted in
   * it also emits the scripted `reasoning` first, one `tool-args` chunk
   * (the whole argument JSON) before each tool call, and a `usage` chunk
   * before `done`. Throws eagerly if the scripted
   * entry carries an `error`.
   */
  public async *stream(
    messages: Message[],
    options?: ModelCallOptions,
  ): AsyncIterable<ModelStreamChunk> {
    this.calls.push({ messages, options });

    const mock = this.nextResponse();
    const signal = options?.signal;

    await waitFor(mock.delay, signal);

    if (mock.error) {
      throw mock.error;
    }

    const want = resolveStreamChunks(options);

    if (want.reasoning) {
      for (const delta of mock.reasoning ?? []) {
        yield { type: "reasoning", delta };
      }
    }

    const chunks = mock.deltas ?? mock.content.split(" ").map((word) => word + " ");

    for (const chunk of chunks) {
      throwIfAborted(signal);
      yield { type: "delta", content: chunk };
    }

    if (mock.toolCalls) {
      for (const toolCall of mock.toolCalls) {
        throwIfAborted(signal);
        if (want.toolArgs) {
          yield {
            type: "tool-args",
            callId: toolCall.id,
            name: toolCall.name,
            delta: JSON.stringify(toolCall.input ?? {}),
          };
        }

        yield {
          type: "tool-call",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        };
      }
    }

    const response = this.buildResponse(mock);

    throwIfAborted(signal);
    if (want.usage) {
      yield { type: "usage", usage: response.usage };
    }

    yield {
      type: "done",
      finishReason: response.finishReason,
      usage: response.usage,
      ...(response.blocks ? { blocks: response.blocks } : {}),
    };
  }

  /**
   * Reset call history and response pointer back to their initial state.
   * Intended for test-suite `beforeEach` hooks so a single `MockModel`
   * instance can be reused across cases without cross-test leakage.
   */
  public reset(): void {
    this.calls = [];
    this.responseIndex = 0;
  }
}

/**
 * The finish reason a scripted entry implies when it sets none: scripted
 * tool calls mean the model stopped to call tools.
 */
function inferFinishReason(mock: MockModelResponse): FinishReason {
  return mock.toolCalls !== undefined && mock.toolCalls.length > 0 ? "tool_calls" : "stop";
}

/** The error an aborted call rejects with — the signal's own reason when it is an `Error`. */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;

  return reason instanceof Error
    ? reason
    : new DOMException("This operation was aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

/**
 * Wait `delay` ms (none when absent), rejecting as soon as `signal` aborts —
 * including when it was aborted before the call started.
 */
async function waitFor(delay: number | undefined, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);

  if (!delay) {
    return;
  }

  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, delay));

    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delay);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
