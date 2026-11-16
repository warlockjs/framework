import { describe, expect, it, vi } from "vitest";
import { SyncFanoutQueue } from "./sync-fanout";

describe("SyncFanoutQueue", () => {
  it("retries a failed fan-out and keeps later jobs moving", async () => {
    const executeFirst = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(undefined);
    const executeSecond = vi.fn().mockResolvedValue(undefined);
    const reportFailure = vi.fn();
    const queue = new SyncFanoutQueue({ retryDelay: () => 0, reportFailure });

    queue.enqueue({ sourceModel: "Category", operation: "update", execute: executeFirst });
    queue.enqueue({ sourceModel: "Category", operation: "restore", execute: executeSecond });

    await queue.flush();

    expect(executeFirst).toHaveBeenCalledTimes(2);
    expect(executeSecond).toHaveBeenCalledTimes(1);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("reports failure once after the last retry fails", async () => {
    const error = new Error("permanent");
    const execute = vi.fn().mockRejectedValue(error);
    const reportFailure = vi.fn();
    const queue = new SyncFanoutQueue({ maxAttempts: 3, retryDelay: () => 0, reportFailure });
    const job = { sourceModel: "Category", operation: "update", execute };

    queue.enqueue(job);

    await queue.flush();

    expect(execute).toHaveBeenCalledTimes(3);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(job, error);
  });

  it("queues nothing when no listener is subscribed", async () => {
    const reportFailure = vi.fn();
    const queue = new SyncFanoutQueue({ reportFailure });

    queue.enqueue({ sourceModel: "Category", operation: "update", listeners: () => [] });

    await queue.flush();

    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("retries only the listener that failed", async () => {
    const stable = vi.fn().mockResolvedValue(undefined);
    const flaky = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue(undefined);
    const reportFailure = vi.fn();
    const queue = new SyncFanoutQueue({ retryDelay: () => 0, reportFailure });

    queue.enqueue({
      sourceModel: "Category",
      operation: "update",
      listeners: () => [stable, flaky],
      args: ["model", ["name"]],
    });

    await queue.flush();

    expect(stable).toHaveBeenCalledTimes(1);
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(flaky).toHaveBeenCalledWith("model", ["name"]);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("runs the other listeners when one fails for good", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("permanent"));
    const after = vi.fn().mockResolvedValue(undefined);
    const reportFailure = vi.fn();
    const queue = new SyncFanoutQueue({ maxAttempts: 2, retryDelay: () => 0, reportFailure });

    queue.enqueue({
      sourceModel: "Category",
      operation: "update",
      listeners: () => [failing, after],
    });

    await queue.flush();

    expect(failing).toHaveBeenCalledTimes(2);
    expect(after).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledTimes(1);
  });

  it("runs different documents side by side and keeps one document in order", async () => {
    const order: string[] = [];
    const gates = new Map<string, () => void>();
    const job = (key: string, label: string) => ({
      sourceModel: "Category",
      operation: "update",
      key,
      execute: async () => {
        order.push(`start ${label}`);
        await new Promise<void>((resolve) => gates.set(label, resolve));
        order.push(`end ${label}`);
      },
    });
    const queue = new SyncFanoutQueue({ concurrency: 2 });

    queue.enqueue(job("a", "a1"));
    queue.enqueue(job("a", "a2"));
    queue.enqueue(job("b", "b1"));

    await vi.waitFor(() => expect(order).toEqual(["start a1", "start b1"]));

    gates.get("a1")?.();
    await vi.waitFor(() => expect(order).toContain("start a2"));
    expect(order.indexOf("end a1")).toBeLessThan(order.indexOf("start a2"));

    gates.get("b1")?.();
    gates.get("a2")?.();
    await queue.flush();

    expect(order).toContain("end a2");
  });

  it("runs one job at a time by default", async () => {
    let active = 0;
    let peak = 0;
    const queue = new SyncFanoutQueue();
    const execute = async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
    };

    queue.enqueue({ sourceModel: "A", operation: "update", key: "a:1", execute });
    queue.enqueue({ sourceModel: "A", operation: "update", key: "a:2", execute });

    await queue.flush();

    expect(peak).toBe(1);
  });
});
