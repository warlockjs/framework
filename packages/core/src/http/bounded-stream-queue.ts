import type { ServerResponse } from "node:http";
import type { StreamTransport } from "./stream-transport";

export type StreamQueueOptions = {
  /** Total unsent bytes, including Node's writable buffer. Defaults to 1 MiB for enqueue(). */
  maxQueuedBytes?: number;
  /** Disconnect the slow client (default), or reject the newest chunk without disconnecting. */
  onOverflow?: "disconnect" | "drop";
};

export function validateStreamQueueOptions(options: StreamQueueOptions): void {
  if (
    options.onOverflow !== undefined &&
    options.onOverflow !== "drop" &&
    options.onOverflow !== "disconnect"
  ) {
    throw new TypeError('onOverflow must be "drop" or "disconnect"');
  }
  if (
    options.maxQueuedBytes !== undefined &&
    (!Number.isSafeInteger(options.maxQueuedBytes) || options.maxQueuedBytes < 0)
  ) {
    throw new RangeError("maxQueuedBytes must be a non-negative safe integer");
  }
}

export function createBoundedStreamQueue(
  raw: ServerResponse,
  transport: StreamTransport,
  options: StreamQueueOptions,
) {
  validateStreamQueueOptions(options);
  const limit = options.maxQueuedBytes ?? 1024 * 1024;
  const pending: Array<{ data: string | Uint8Array; bytes: number }> = [];
  const waiters = new Set<(drained: boolean) => void>();
  let bytes = 0;
  let ending = false;
  let dropped = 0;
  let onFinished: (() => void) | undefined;

  function settle(drained: boolean) {
    for (const resolve of waiters) resolve(drained);
    waiters.clear();
  }
  function cleanup() {
    raw.off("drain", flush);
    raw.off("close", close);
  }
  function close() {
    ending = true;
    pending.length = 0;
    bytes = 0;
    onFinished = undefined;
    cleanup();
    settle(false);
  }
  function flush() {
    if (transport.closed) return close();
    while (pending.length && !raw.writableNeedDrain) {
      const item = pending.shift()!;
      bytes -= item.bytes;
      raw.write(item.data);
    }
    if (!pending.length && !raw.writableNeedDrain) settle(!ending);
    if (!pending.length && onFinished) {
      const finish = onFinished;
      onFinished = undefined;
      cleanup();
      settle(false);
      finish();
    }
  }
  raw.on("drain", flush);
  raw.once("close", close);

  return {
    get dropped() {
      return dropped;
    },
    get ending() {
      return ending;
    },
    get backpressured() {
      return pending.length > 0 || transport.backpressured;
    },
    enqueue(data: string | Uint8Array): boolean {
      if (typeof data !== "string" && !(data instanceof Uint8Array))
        throw new TypeError("Stream data must be a string or Uint8Array");
      if (ending || transport.closed) return false;
      const size = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
      if (bytes + (raw.writableLength ?? 0) + size > limit) {
        if (options.onOverflow === "drop") dropped++;
        else {
          transport.disconnect();
          close();
          raw.destroy();
        }
        return false;
      }
      if (pending.length || raw.writableNeedDrain) {
        // Own the bytes: a producer may reuse its Uint8Array after enqueue().
        pending.push({ data: typeof data === "string" ? data : Buffer.from(data), bytes: size });
        bytes += size;
      } else {
        raw.write(data);
      }
      return true;
    },
    waitForDrain(): Promise<boolean> {
      if (ending || transport.closed) return Promise.resolve(false);
      if (!pending.length && !raw.writableNeedDrain) return Promise.resolve(true);
      return new Promise((resolve) => waiters.add(resolve));
    },
    finish(callback: () => void) {
      if (ending || transport.closed) return;
      ending = true;
      onFinished = callback;
      flush();
    },
  };
}
