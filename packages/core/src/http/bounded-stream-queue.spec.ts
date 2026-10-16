import type { ServerResponse } from "node:http";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createBoundedStreamQueue } from "./bounded-stream-queue";
import { createStreamTransport } from "./stream-transport";

function fixture(maxQueuedBytes = 8, onOverflow: "drop" | "disconnect" = "drop") {
  const written: string[] = [];
  const callbacks: Array<() => void> = [];
  const writable = new Writable({
    highWaterMark: 4,
    write(chunk, _encoding, callback) {
      written.push(chunk.toString());
      callbacks.push(callback);
    },
  });
  const raw = writable as unknown as ServerResponse;
  const transport = createStreamTransport(raw, { disconnectMessage: "Slow client" });
  const queue = createBoundedStreamQueue(raw, transport, { maxQueuedBytes, onOverflow });
  return { writable, raw, transport, queue, written, callbacks };
}

describe("bounded stream queue", () => {
  it("counts Node buffered bytes, drops newest overflow, and drains in order", async () => {
    const { queue, callbacks, written } = fixture();
    expect(queue.enqueue("aaaa")).toBe(true);
    expect(queue.enqueue("bbbb")).toBe(true);
    expect(queue.enqueue("c")).toBe(false);
    const drained = queue.waitForDrain();
    expect(written).toEqual(["aaaa"]);
    callbacks.shift()!();
    expect(written).toEqual(["aaaa", "bbbb"]);
    callbacks.shift()!();
    expect(await drained).toBe(true);
  });

  it("disconnects and aborts the producer on overflow", async () => {
    const { queue, transport, writable } = fixture(8, "disconnect");
    queue.enqueue("aaaa");
    queue.enqueue("bbbb");
    const drained = queue.waitForDrain();
    expect(queue.enqueue("c")).toBe(false);
    expect(writable.destroyed).toBe(true);
    expect(transport.signal.aborted).toBe(true);
    expect(queue.enqueue("later")).toBe(false);
    expect(await drained).toBe(false);
  });

  it("flushes accepted queued chunks before ending", () => {
    const { queue, callbacks, written, transport } = fixture();
    queue.enqueue("aaaa");
    queue.enqueue("bbbb");
    let finished = false;
    queue.finish(() => {
      finished = true;
      transport.finish();
    });
    expect(finished).toBe(false);
    expect(queue.enqueue("later")).toBe(false);
    callbacks.shift()!();
    expect(written).toEqual(["aaaa", "bbbb"]);
    expect(finished).toBe(true);
  });

  it("measures UTF-8 bytes and owns queued mutable chunks", () => {
    const { queue, callbacks, written } = fixture();
    queue.enqueue("éé");
    const chunk = Buffer.from("bbbb");
    expect(queue.enqueue(chunk)).toBe(true);
    chunk.fill("z");
    expect(queue.enqueue("é")).toBe(false);
    callbacks.shift()!();
    expect(written).toEqual(["éé", "bbbb"]);
  });

  it("releases waiting producers on disconnect and removes listeners", async () => {
    const { queue, raw, transport } = fixture();
    queue.enqueue("aaaa");
    queue.enqueue("bbbb");
    const drained = queue.waitForDrain();
    raw.emit("close");
    expect(await drained).toBe(false);
    expect(transport.signal.aborted).toBe(true);
    expect(raw.listenerCount("drain")).toBe(0);
  });

  it.each([-1, 1.5, Infinity, NaN])("rejects invalid byte cap %s", (maxQueuedBytes) => {
    expect(() => fixture(maxQueuedBytes)).toThrow(/maxQueuedBytes/);
  });
});
