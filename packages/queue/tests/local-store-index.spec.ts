import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/drivers/memory-store";
import type { LocalJob } from "../src/drivers/local-store";

const makeJob = (id: string, patch: Partial<LocalJob> = {}): LocalJob => ({
  id,
  queue: "q",
  name: "job",
  data: {},
  options: {} as LocalJob["options"],
  state: "waiting",
  createdAt: 0,
  readyAt: 0,
  attemptsMade: 0,
  priority: 0,
  progress: 0,
  logs: [],
  stacktrace: [],
  leaseUntil: 0,
  ...patch,
});

describe("MemoryStore ready index", () => {
  it("picks the lowest priority, then the oldest job", () => {
    const store = new MemoryStore();
    store.put(makeJob("a", { priority: 5 }));
    store.put(makeJob("b", { priority: 1 }));
    store.put(makeJob("c", { priority: 1 }));
    expect(store.ready("q", 10)?.id).toBe("b");
    store.remove("q", "b");
    expect(store.ready("q", 10)?.id).toBe("c");
  });

  it("ignores finished jobs and jobs of other queues", () => {
    const store = new MemoryStore();
    store.put(makeJob("done", { state: "completed", finishedAt: 1 }));
    store.put(makeJob("other", { queue: "other" }));
    expect(store.ready("q", 10)).toBeUndefined();
    store.put(makeJob("done", { state: "waiting" }));
    expect(store.ready("q", 10)?.id).toBe("done");
  });

  it("respects readyAt and expired leases", () => {
    const store = new MemoryStore();
    store.put(makeJob("later", { state: "delayed", readyAt: 100 }));
    store.put(makeJob("held", { state: "active", leaseUntil: 50 }));
    expect(store.ready("q", 10)).toBeUndefined();
    expect(store.ready("q", 60)?.id).toBe("held");
    expect(store.ready("q", 100)?.id).toBe("later");
  });

  it("rebuilds the index when a transaction rolls back", () => {
    const store = new MemoryStore();
    store.put(makeJob("a"));
    expect(() =>
      store.transaction(() => {
        store.remove("q", "a");
        store.put(makeJob("b"));
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(store.ready("q", 10)?.id).toBe("a");
    expect(store.list("q").map((job) => job.id)).toEqual(["a"]);
  });
});
