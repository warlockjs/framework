import { describe, expect, it, vi } from "vitest";
import { SyncFanoutQueue } from "./sync-fanout";

describe("SyncFanoutQueue", () => {
  it("retries a failed fan-out and keeps later jobs moving", async () => {
    const executeFirst = vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce(undefined);
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
});
