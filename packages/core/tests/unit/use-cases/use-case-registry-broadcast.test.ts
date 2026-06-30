import config from "@mongez/config";
import { cache, MemoryCacheDriver } from "@warlock.js/cache";
import { v } from "@warlock.js/seal";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getUseCase, getUseCases, useCase } from "../../../src/use-cases";
import type { UseCaseBroadcastChannel, UseCaseBroadcastEvent } from "../../../src/use-cases/types";
import { BadSchemaUseCaseError } from "../../../src/use-cases/use-case.errors";
import { getUseCaseHistory } from "../../../src/use-cases/use-cases-registry";

let nameCounter = 0;

function uniqueName(label: string): string {
  return `unit-ucrb-${label}-${nameCounter++}`;
}

beforeAll(async () => {
  const driver = new MemoryCacheDriver();

  driver.setOptions({});
  driver.setLoggingState(false);

  await cache.use(driver);
});

beforeEach(() => {
  config.set("use-cases", { benchmark: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCase — schema validation", () => {
  it("throws BadSchemaUseCaseError when the input fails the schema", async () => {
    const run = useCase({
      name: uniqueName("schema-fail"),
      schema: v.object({ name: v.string().required() }),
      handler: async () => ({ ok: true }),
    });

    await expect(run({})).rejects.toBeInstanceOf(BadSchemaUseCaseError);
  });

  it("passes the validated data to the handler", async () => {
    const run = useCase<{ received: unknown }, { name: string; age: number }>({
      name: uniqueName("schema-pass"),
      schema: v.object({ name: v.string(), age: v.number() }),
      handler: async (data) => ({ received: data }),
    });

    const result = await run({ name: "Ada", age: 36 });

    expect(result.received).toEqual({ name: "Ada", age: 36 });
  });
});

describe("useCase — registry", () => {
  it("tracks success call counts", async () => {
    const name = uniqueName("success-counter");

    const run = useCase({
      name,
      handler: async () => ({ ok: true }),
    });

    await run({});
    await run({});

    const registered = getUseCase(name) as { calls: { success: number; total: number } };

    expect(registered.calls.success).toBe(2);
    expect(registered.calls.total).toBe(2);
  });

  it("exposes registered use cases through getUseCases()", () => {
    const name = uniqueName("in-map");

    useCase({
      name,
      handler: async () => ({ ok: true }),
    });

    expect(getUseCases().has(name)).toBe(true);
  });

  it("exposes the runtime calls counters without an ad-hoc cast", async () => {
    const name = uniqueName("calls-typed");

    const run = useCase({
      name,
      handler: async () => ({ ok: true }),
    });

    await run({});

    const registered = getUseCase(name);

    // `calls` is part of the returned type (RegisteredUseCase) — no cast needed.
    expect(registered?.calls.success).toBe(1);
    expect(registered?.calls.total).toBe(1);
  });

  it("$cleanup does not reject when the cache namespace removal fails", async () => {
    vi.spyOn(cache, "removeNamespace").mockRejectedValueOnce(new Error("cache down"));

    const name = uniqueName("cleanup-best-effort");

    const run = useCase({
      name,
      handler: async () => ({ ok: true }),
    });

    // $cleanup is synchronous and best-effort — a rejecting removeNamespace must
    // not throw synchronously or surface as an unhandled rejection.
    expect(() => run.$cleanup()).not.toThrow();

    // Let the swallowed rejection settle so it can't leak into another test.
    await Promise.resolve();

    expect(getUseCase(name)).toBeUndefined();
  });
});

describe("useCase — history", () => {
  it("records a completed execution in history", async () => {
    const name = uniqueName("history-record");

    const run = useCase({
      name,
      handler: async () => ({ ok: true }),
    });

    await run({}, { id: "history-id-1" });

    const history = await getUseCaseHistory(name);

    expect(history.map((entry) => entry.id)).toContain("history-id-1");
  });

  it("caps history at maxEntries, evicting the oldest", async () => {
    const name = uniqueName("history-cap");

    config.set("use-cases", {
      benchmark: false,
      history: { enabled: true, maxEntries: 2 },
    });

    const run = useCase({
      name,
      handler: async () => ({ ok: true }),
    });

    await run({}, { id: "h1" });
    await run({}, { id: "h2" });
    await run({}, { id: "h3" });

    const history = await getUseCaseHistory(name);
    const ids = history.map((entry) => entry.id);

    expect(ids).toHaveLength(2);
    expect(ids).not.toContain("h1");
    expect(ids).toEqual(expect.arrayContaining(["h2", "h3"]));
  });

  it("does not record history when disabled", async () => {
    const name = uniqueName("history-off");

    config.set("use-cases", {
      benchmark: false,
      history: { enabled: false },
    });

    const run = useCase({
      name,
      handler: async () => ({ ok: true }),
    });

    await run({}, { id: "should-not-persist" });

    const history = await getUseCaseHistory(name);

    expect(history).toEqual([]);
  });
});

describe("useCase — broadcast", () => {
  it("sends the output to a registered channel when broadcast is enabled", async () => {
    const received: UseCaseBroadcastEvent[] = [];

    const channel: UseCaseBroadcastChannel = {
      broadcast(event) {
        received.push(event);
      },
    };

    config.set("use-cases", {
      benchmark: false,
      broadcast: { enabled: true, channels: [channel] },
    });

    const name = uniqueName("broadcast-on");

    const run = useCase<{ id: number }, any>({
      name,
      handler: async () => ({ id: 7 }),
      broadcast: true,
    });

    await run({});

    expect(received).toHaveLength(1);
    expect(received[0].useCase).toBe(name);
    expect(received[0].payload).toEqual({ id: 7 });
  });

  it("projects the payload when broadcast.output is provided", async () => {
    const received: UseCaseBroadcastEvent[] = [];

    const channel: UseCaseBroadcastChannel = {
      broadcast(event) {
        received.push(event);
      },
    };

    config.set("use-cases", {
      benchmark: false,
      broadcast: { enabled: true, channels: [channel] },
    });

    const run = useCase<{ id: number; secret: string }, any>({
      name: uniqueName("broadcast-projected"),
      handler: async () => ({ id: 7, secret: "hidden" }),
      broadcast: {
        event: "custom-event",
        output: (output) => ({ id: output.id }),
      },
    });

    await run({});

    expect(received[0].event).toBe("custom-event");
    expect(received[0].payload).toEqual({ id: 7 });
  });

  it("does not broadcast when the use case does not opt in", async () => {
    const received: UseCaseBroadcastEvent[] = [];

    const channel: UseCaseBroadcastChannel = {
      broadcast(event) {
        received.push(event);
      },
    };

    config.set("use-cases", {
      benchmark: false,
      broadcast: { enabled: true, channels: [channel] },
    });

    const run = useCase({
      name: uniqueName("broadcast-opt-out"),
      handler: async () => ({ ok: true }),
    });

    await run({});

    expect(received).toHaveLength(0);
  });
});
