import { afterEach, describe, expect, it, vi } from "vitest";
import { defineJob, getDispatchInterceptor, setDispatchInterceptor } from "../src";

/**
 * The seam test fakes use (`queueFake` in `@warlock.js/core/tests`): with an
 * interceptor installed, dispatch and find never reach BullMQ or Redis.
 */
describe("dispatch interceptor", () => {
  afterEach(() => setDispatchInterceptor(undefined));

  it("hands dispatches to the interceptor instead of the broker", async () => {
    const dispatch = vi.fn(() => ({ id: "fake-1", name: "reports.build", queue: "reports" }));

    setDispatchInterceptor({ dispatch });

    const job = defineJob({
      name: "reports.build",
      queue: "reports",
      async handle(_payload: { reportId: string }) {},
    });

    await expect(job.dispatch({ reportId: "7" }, { delay: "1m" })).resolves.toEqual({
      id: "fake-1",
      name: "reports.build",
      queue: "reports",
    });
    expect(dispatch).toHaveBeenCalledWith({
      name: "reports.build",
      queue: "reports",
      payload: { reportId: "7" },
      options: { delay: "1m" },
    });
  });

  it("answers find() from the interceptor", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");

    setDispatchInterceptor({
      dispatch: () => ({ id: "x", name: "reports.find", queue: "default" }),
      find: ({ id }) => ({
        id,
        name: "reports.find",
        queue: "default",
        state: "waiting",
        payload: { reportId: "1" },
        progress: 0,
        attemptsMade: 0,
        createdAt,
      }),
    });

    const job = defineJob({
      name: "reports.find",
      async handle(_payload: { reportId: string }) {},
    });

    await expect(job.find("x")).resolves.toMatchObject({ id: "x", state: "waiting" });
  });

  it("is one process-wide slot", () => {
    const interceptor = { dispatch: () => ({ id: "1", name: "n", queue: "q" }) };

    setDispatchInterceptor(interceptor);

    expect(getDispatchInterceptor()).toBe(interceptor);
    expect(
      (globalThis as Record<symbol, unknown>)[Symbol.for("warlock.queue.dispatchInterceptor")],
    ).toBe(interceptor);
  });
});
