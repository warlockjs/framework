import { afterEach, describe, expect, it, vi } from "vitest";
import { Queue } from "../../../src/utils/queue";

afterEach(() => {
  vi.useRealTimers();
});

// NOTE on the execution model: regardless of parallel vs sequential, the queue
// invokes executeFn once PER item with a single-element array ([item]) — it
// never hands the whole batch to executeFn in one call. batchSize only caps how
// many items a single flush drains from the buffer.

describe("Queue", () => {
  it("flushes once the queue reaches maxSize, one call per item", async () => {
    const calls: number[][] = [];

    const queue = new Queue<number>(
      async (items) => {
        calls.push(items);
      },
      false, // sequential
      5000,
      10, // batchSize large enough to drain both
      2, // maxSize triggers flush at 2 items
    );

    queue.enqueue(1);
    queue.enqueue(2);

    await vi.waitFor(() => expect(calls.length).toBe(2));

    expect(calls).toEqual([[1], [2]]);
  });

  it("runs each item as its own call when executing in parallel", async () => {
    const calls: number[][] = [];

    const queue = new Queue<number>(
      async (items) => {
        calls.push(items);
      },
      true, // parallel
      5000,
      10,
      3, // maxSize
    );

    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);

    await vi.waitFor(() => expect(calls.length).toBe(3));

    expect(calls).toEqual([[1], [2], [3]]);
  });

  it("only drains up to batchSize per flush", async () => {
    const calls: number[][] = [];

    const queue = new Queue<number>(
      async (items) => {
        calls.push(items);
      },
      false,
      5000,
      2, // batchSize 2
      4, // maxSize 4 -> flush, but only the first 2 are processed
    );

    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    queue.enqueue(4);

    await vi.waitFor(() => expect(calls.length).toBe(2));

    expect(calls).toEqual([[1], [2]]);
  });

  it("flushes on the interval timer when maxSize is never reached", async () => {
    vi.useFakeTimers();

    const calls: string[][] = [];

    const queue = new Queue<string>(
      async (items) => {
        calls.push(items);
      },
      false,
      1000, // executeEvery
      10, // batchSize
      // no maxSize
    );

    queue.enqueue("a");
    queue.enqueue("b");

    await vi.advanceTimersByTimeAsync(1000);

    expect(calls).toEqual([["a"], ["b"]]);
  });
});
