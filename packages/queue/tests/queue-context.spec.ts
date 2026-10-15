import { AsyncLocalStorage } from "node:async_hooks";
import { UnrecoverableError, type Job } from "bullmq";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const add = vi.fn(async (_name: string, _data: unknown, _opts: unknown) => ({ id: "1" }));

vi.mock("../src/queue-manager", () => ({ getQueue: () => ({ add }) }));

import {
  defineJob,
  defineQueueContext,
  resetQueueContext,
  resetQueueConfig,
  setQueueConfig,
  setQueueContext,
  UnrecoverableJobError,
} from "../src";
import { processJob } from "../src/process-job";

const tenantStore = new AsyncLocalStorage<string>();
const withTenant = <T>(id: string, run: () => T): T => tenantStore.run(id, run);

const capture = vi.fn(() => tenantStore.getStore());
const tenantContext = defineQueueContext({
  capture,
  restore: (tenant, run) => tenantStore.run(tenant, run),
});

/** Run the last enqueued data through the processor like a worker would. */
function fakeJob(name: string, data: unknown): Job {
  return {
    id: "1",
    name,
    data,
    queueName: "default",
    attemptsMade: 0,
    opts: {},
    updateProgress: async () => {},
    log: async () => 0,
  } as unknown as Job;
}

const lastData = () => add.mock.calls.at(-1)![1] as any;

beforeEach(() => {
  add.mockClear();
  capture.mockClear();
  setQueueConfig({ connection: {} });
  setQueueContext(tenantContext);
});

afterEach(() => {
  resetQueueContext();
  resetQueueConfig();
});

describe("queue context", () => {
  it("round-trips the payload through the envelope; old jobs pass through", async () => {
    let seen: unknown;
    const job = defineJob({ name: "ctx.roundtrip", handle: async (p: { a: number }) => (seen = p) });

    await withTenant("t1", () => job.dispatch({ a: 1 }));
    expect(lastData()).toEqual({ __warlock: { v: 1, context: "t1" }, payload: { a: 1 } });

    await processJob(fakeJob("ctx.roundtrip", lastData()));
    expect(seen).toEqual({ a: 1 });

    await processJob(fakeJob("ctx.roundtrip", { a: 2 }));
    expect(seen).toEqual({ a: 2 });
  });

  it("captures at dispatch; undefined adds no envelope", async () => {
    const job = defineJob({ name: "ctx.capture", handle: async (_p: { a: number }) => {} });

    await job.dispatch({ a: 1 });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(lastData()).toEqual({ a: 1 });
  });

  it("restore wraps handle and exposes ctx.context", async () => {
    let inside: string | undefined;
    let ctxValue: unknown;
    const job = defineJob({
      name: "ctx.restore",
      handle: async (_p: {}, ctx) => {
        inside = tenantStore.getStore();
        ctxValue = ctx.context;
      },
    });

    await withTenant("t2", () => job.dispatch({}));
    await processJob(fakeJob("ctx.restore", lastData()));
    expect(inside).toBe("t2");
    expect(ctxValue).toBe("t2");
  });

  it("nested dispatch inside a restored handler captures the same tenant", async () => {
    const child = defineJob({ name: "ctx.child", handle: async (_p: {}) => {} });
    const parent = defineJob({ name: "ctx.parent", handle: async (_p: {}) => void (await child.dispatch({})) });

    await withTenant("t3", () => parent.dispatch({}));
    await processJob(fakeJob("ctx.parent", lastData()));

    expect(add.mock.calls.at(-1)![0]).toBe("ctx.child");
    expect(lastData().__warlock.context).toBe("t3");
  });

  it("maps UnrecoverableJobError to BullMQ's UnrecoverableError, other errors untouched", async () => {
    const fatal = defineJob({
      name: "ctx.fatal",
      handle: async (_p: {}) => {
        throw new UnrecoverableJobError("nope");
      },
    });
    const normal = defineJob({
      name: "ctx.normal",
      handle: async (_p: {}) => {
        throw new Error("retry me");
      },
    });

    await expect(processJob(fakeJob("ctx.fatal", {}))).rejects.toBeInstanceOf(UnrecoverableError);
    const error = await processJob(fakeJob("ctx.normal", {})).catch((e) => e);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(fatal.name).toBe("ctx.fatal");
    expect(normal.name).toBe("ctx.normal");
  });

  it("maps an UnrecoverableJobError from restore to UnrecoverableError", async () => {
    setQueueContext(
      defineQueueContext({
        capture: () => "x",
        restore: async () => {
          throw new UnrecoverableJobError("bad context");
        },
      }),
    );
    defineJob({ name: "ctx.badrestore", handle: async (_p: {}) => {} });

    await expect(
      processJob(fakeJob("ctx.badrestore", { __warlock: { v: 1, context: "x" }, payload: {} })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it("context: false skips capture", async () => {
    const job = defineJob({ name: "ctx.off", context: false, handle: async (_p: {}) => {} });

    await withTenant("t4", () => job.dispatch({}));
    expect(capture).not.toHaveBeenCalled();
    expect(lastData()).toEqual({});
  });

  it("infers restore's captured param from capture", () => {
    defineQueueContext({
      capture: () => ({ tenant: "a" }) as { tenant: string } | undefined,
      restore: (captured, run) => {
        expectTypeOf(captured).toEqualTypeOf<{ tenant: string }>();
        return run();
      },
    });
  });
});
