import type { AgentMiddleware } from "../../contracts/middleware";
import type { MiddlewareTripContext } from "../../contracts/middleware/middleware-context.type";
import type { ModelResponse } from "../../contracts/model.contract";
import { hashText, stableJson } from "../../utils/hash-text";

/**
 * Configuration for `dedupe()`.
 */
export type DedupeOptions = {
  /** Middleware name, also the state-bag key prefix. Default `"dedupe"`. */
  name?: string;
  /**
   * Derive the sharing key yourself. Calls with the same key share one
   * provider call; return `undefined` to leave a call alone. Default: a
   * stable hash of the agent, model, messages and model options.
   */
  key?: (context: MiddlewareTripContext) => string | undefined;
};

type Flight = {
  /** Resolves with the leader's response, or `undefined` when the leader failed. */
  settled: Promise<ModelResponse | undefined>;
  resolve: (response: ModelResponse | undefined) => void;
};

type PendingFlight = { key: string; flight: Flight };

const MAX_FOLLOW_ATTEMPTS = 3;

function defaultKey(context: MiddlewareTripContext): string {
  const options = context.options as { modelOptions?: unknown } | undefined;

  return hashText(
    stableJson({
      agent: context.agent.name,
      model: [context.model.provider, context.model.name],
      messages: context.messages,
      modelOptions: options?.modelOptions,
    }),
  );
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("The operation was aborted");
}

/**
 * Share one provider call between identical model requests that are in
 * flight at the same moment.
 *
 * The first request goes to the model; every identical request that arrives
 * before it finishes waits for it and receives the same response, with zero
 * usage, so a burst of the same prompt costs one call. Nothing is stored
 * after the call ends, so use `semanticCache()` for reuse over time.
 * If the first request fails, each waiting request makes its own call.
 *
 * The map is local to the process. Streaming runs (`agent.stream()`) are not
 * deduplicated: each stream needs its own chunks.
 *
 * Install it after `semanticCache()` in the list, so a cache hit
 * never opens a flight.
 *
 * @example
 * const myAgent = agent({ model, middleware: [dedupe()] });
 */
export function dedupe(options: DedupeOptions = {}): AgentMiddleware {
  const name = options.name ?? "dedupe";
  const pendingKey = `${name}.pending`;
  const flights = new Map<string, Flight>();

  const release = (context: MiddlewareTripContext, response: ModelResponse | undefined): void => {
    const pending = context.state.get(pendingKey) as PendingFlight | undefined;

    if (!pending) {
      return;
    }

    context.state.delete(pendingKey);

    if (flights.get(pending.key) === pending.flight) {
      flights.delete(pending.key);
    }

    pending.flight.resolve(response);
  };

  return {
    name,
    log: true,
    trip: {
      async before(context) {
        if (context.streaming) {
          return;
        }

        const key = options.key ? options.key(context) : defaultKey(context);

        if (key === undefined) {
          return;
        }

        for (let attempt = 0; attempt < MAX_FOLLOW_ATTEMPTS; attempt++) {
          const running = flights.get(key);

          if (!running) {
            break;
          }

          const shared = await waitFor(running, context.signal);

          if (shared) {
            return {
              content: shared.content,
              finishReason: shared.finishReason,
              usage: { input: 0, output: 0, total: 0 },
              toolCalls: shared.toolCalls,
            };
          }
        }

        if (flights.has(key)) {
          return;
        }

        let resolve!: Flight["resolve"];
        const settled = new Promise<ModelResponse | undefined>((done) => {
          resolve = done;
        });
        const flight: Flight = { settled, resolve };

        flights.set(key, flight);
        context.state.set(pendingKey, { key, flight } satisfies PendingFlight);

        return;
      },
      after(context, response) {
        release(context, response);
      },
      onError(context) {
        release(context, undefined);
      },
    },
  };
}

async function waitFor(
  flight: Flight,
  signal: AbortSignal | undefined,
): Promise<ModelResponse | undefined> {
  if (!signal) {
    return flight.settled;
  }

  if (signal.aborted) {
    throw abortReason(signal);
  }

  let onAbort: (() => void) | undefined;

  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([flight.settled, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort as () => void);
  }
}
