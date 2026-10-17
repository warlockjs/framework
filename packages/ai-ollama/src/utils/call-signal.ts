import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-call cancellation for the `ollama` client.
 *
 * The `ollama` client (0.6) takes no per-request `AbortSignal`: a
 * non-streaming `chat()` cannot be cancelled at all, and a streamed one only
 * through the iterator it returns once the response headers have arrived.
 * To honour `ModelCallOptions.signal` the SDK builds its client with
 * {@link signalAwareFetch}, and the model runs each request inside
 * {@link withCallSignal}; the wrapped `fetch` reads the call's signal from
 * async context and hands it to the real `fetch`, so aborting cancels the
 * HTTP request at any point — before the headers, or mid-body.
 */
const callSignal = new AsyncLocalStorage<AbortSignal | undefined>();

/** Run `operation` with `signal` as the cancellation signal for any `fetch` it makes through {@link signalAwareFetch}. */
export function withCallSignal<T>(signal: AbortSignal | undefined, operation: () => T): T {
  return callSignal.run(signal, operation);
}

/**
 * Wrap a `fetch` so every request also listens to the signal of the call it
 * belongs to (see {@link withCallSignal}), combined with any signal the
 * client set itself.
 */
export function signalAwareFetch(baseFetch: typeof fetch): typeof fetch {
  return (input, init) => {
    const signal = callSignal.getStore();

    if (!signal) {
      return baseFetch(input, init);
    }

    const own = init?.signal ?? undefined;

    return baseFetch(input, {
      ...init,
      signal: own ? AbortSignal.any([own, signal]) : signal,
    });
  };
}
