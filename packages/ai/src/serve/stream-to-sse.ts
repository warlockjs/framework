import { encodeSSE, SSE_DONE } from "./sse";

/**
 * A streamable execution: an async iterable of typed events that also
 * exposes the final `result` promise — exactly the shape every primitive's
 * `stream()` returns ({@link StreamContract}).
 */
export type StreamLike<TEvent extends { type: string }, TResult> = AsyncIterable<TEvent> & {
  result?: Promise<TResult>;
};

/**
 * Optional projections for {@link streamToSSE}. Each defaults to sending
 * the value as it is, so the helper alone is a full-fidelity trace; `serve`
 * passes client-safe projections.
 */
export type StreamToSSEOptions<TEvent extends { type: string }, TResult> = {
  /** Map an event to the frame's data; return `undefined` to drop the event. */
  mapEvent?: (event: TEvent) => unknown;
  /** Map the final result to the `result` frame's data. */
  mapResult?: (result: TResult) => unknown;
  /** Map a rejected `result` to the `error` frame's data. Default `{ message }`. */
  mapError?: (error: unknown) => unknown;
};

/**
 * Convert a primitive's event stream into an SSE byte stream (A3): each
 * event becomes an SSE frame named by its `type`, then the final `result`
 * (or an `error` frame if it rejects) is emitted, and finally the
 * `[DONE]` sentinel. Pure and transport-agnostic — {@link serve} pipes it
 * to an HTTP response, but it works against any sink.
 *
 * Without `options` every event and the whole result are sent verbatim,
 * including tool inputs and outputs and the run report: use it as-is only
 * for trusted consumers, or pass `mapEvent` / `mapResult` to project them.
 *
 * @example
 * for await (const frame of streamToSSE(agent.stream("hi"))) {
 *   res.write(frame);
 * }
 */
export async function* streamToSSE<TEvent extends { type: string }, TResult>(
  stream: StreamLike<TEvent, TResult>,
  options: StreamToSSEOptions<TEvent, TResult> = {},
): AsyncIterable<string> {
  const { mapEvent, mapResult, mapError } = options;

  for await (const event of stream) {
    const data = mapEvent ? mapEvent(event) : event;

    if (data !== undefined) {
      yield encodeSSE({ event: event.type, data });
    }
  }

  if (stream.result) {
    try {
      const result = await stream.result;
      yield encodeSSE({ event: "result", data: (mapResult ? mapResult(result) : result) ?? null });
    } catch (error) {
      yield encodeSSE({
        event: "error",
        data: mapError
          ? mapError(error)
          : { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  yield SSE_DONE;
}
