import type { ServerResponse } from "node:http";
import { log } from "@warlock.js/logger";

/**
 * Shared transport bookkeeping for the long-lived responses
 * (`response.sse()` and `response.stream()`): client-disconnect detection,
 * an `AbortSignal` for the work feeding the stream, and backpressure.
 */
export type StreamTransport = {
  /** Aborted when the client disconnects (not when the stream is ended). */
  readonly signal: AbortSignal;
  /** `true` once the stream was ended or the client disconnected. */
  readonly closed: boolean;
  /** `true` once the client disconnected before the stream was ended. */
  readonly disconnected: boolean;
  /** Whether the transport holds more than its high-water mark. */
  readonly backpressured: boolean;
  /** Mark the stream as ended by the server. */
  finish(): void;
  /** Call `handler` when the client disconnects. */
  onDisconnect(handler: () => void): void;
  /**
   * Resolve once the transport has flushed what it buffered: `true` when the
   * client can take more, `false` when the stream ended or the client left.
   */
  waitForDrain(): Promise<boolean>;
};

export function createStreamTransport(
  raw: ServerResponse,
  options: { disconnectMessage: string; onClientDisconnected?: () => void },
): StreamTransport {
  let closed = false;
  let disconnected = false;
  const disconnectHandlers: Array<() => void> = [];
  const disconnectController = new AbortController();

  // Without this, background jobs keep writing to a dead socket after the
  // client drops. `close` also fires after a normal `end()`; `closed` is
  // already set by then.
  raw.on("close", () => {
    if (closed) return;

    closed = true;
    disconnected = true;
    options.onClientDisconnected?.();
    disconnectController.abort(new DOMException(options.disconnectMessage, "AbortError"));

    // Each handler is isolated: this runs inside the socket's `close`
    // listener, so a throwing handler would otherwise become an uncaught
    // exception (taking the process down) and skip the handlers after it.
    for (const handler of disconnectHandlers) {
      try {
        handler();
      } catch (error) {
        log.error("http", "stream", error as Error, { source: "onDisconnect handler" });
      }
    }
  });

  return {
    signal: disconnectController.signal,

    get closed() {
      return closed;
    },

    get disconnected() {
      return disconnected;
    },

    get backpressured() {
      return !closed && raw.writableNeedDrain;
    },

    finish() {
      closed = true;
    },

    onDisconnect(handler) {
      disconnectHandlers.push(handler);
    },

    waitForDrain() {
      if (closed) return Promise.resolve(false);

      if (!raw.writableNeedDrain) return Promise.resolve(true);

      return new Promise<boolean>((resolve) => {
        const settle = (drained: boolean) => {
          raw.off("drain", onDrain);
          raw.off("close", onClose);
          resolve(drained);
        };
        const onDrain = () => settle(!closed);
        const onClose = () => settle(false);

        raw.once("drain", onDrain);
        raw.once("close", onClose);
      });
    },
  };
}

/**
 * The most recent `limit` items, for logging/debugging a stream after it
 * ended. `limit` 0 (or missing/NaN) keeps nothing, so a long-lived stream
 * does not grow with its own history.
 */
export function createRetainedTail<T>(limit: number | undefined): {
  push(item: T): void;
  items: T[];
} {
  const max = limit === undefined || Number.isNaN(limit) ? 0 : Math.max(0, Math.floor(limit));
  const items: T[] = [];

  return {
    items,
    push(item) {
      if (max === 0) return;

      items.push(item);

      if (items.length > max) items.shift();
    },
  };
}
