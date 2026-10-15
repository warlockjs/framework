import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryTraceStore } from "../store/in-memory-trace-store";
import { makeTrace } from "../test-support/make-trace";
import { dashboard } from "./dashboard";
import type { DashboardHandle } from "./dashboard.type";

/** Track open handles so each test releases its port. */
const handles: DashboardHandle[] = [];

afterEach(async () => {
  while (handles.length > 0) {
    const handle = handles.pop();
    await handle?.close();
  }
});

/** Start a dashboard on an ephemeral port and remember it for cleanup. */
async function start(store = createInMemoryTraceStore()): Promise<DashboardHandle> {
  const handle = await dashboard(store, { port: 0 });
  handles.push(handle);

  return handle;
}

describe("dashboard", () => {
  it("binds an ephemeral port when port:0 and returns the real port", async () => {
    const handle = await start();

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/`);
  });

  it("binds loopback (127.0.0.1) by default", async () => {
    const handle = await start();

    expect(handle.url.startsWith("http://127.0.0.1:")).toBe(true);
  });

  it("serves the seeded traces newest-first on GET /api/traces", async () => {
    const store = createInMemoryTraceStore();
    store.add(makeTrace({ traceId: "t1", startedAt: "2026-06-22T10:00:00.000Z" }));
    store.add(makeTrace({ traceId: "t2", startedAt: "2026-06-22T11:00:00.000Z" }));
    const handle = await start(store);

    const res = await fetch(`${handle.url}api/traces`);
    const body = (await res.json()) as Array<{ traceId: string }>;

    expect(res.status).toBe(200);
    expect(body.map((t) => t.traceId)).toEqual(["t2", "t1"]);
  });

  it("filters traces by repeated status query params", async () => {
    const store = createInMemoryTraceStore();
    store.add(makeTrace({ traceId: "ok", status: "completed" }));
    store.add(makeTrace({ traceId: "bad", status: "failed" }));
    store.add(makeTrace({ traceId: "stop", status: "cancelled" }));
    const handle = await start(store);

    const res = await fetch(`${handle.url}api/traces?status=failed&status=cancelled`);
    const body = (await res.json()) as Array<{ traceId: string }>;

    expect(new Set(body.map((t) => t.traceId))).toEqual(new Set(["bad", "stop"]));
  });

  it("returns the aggregate on GET /api/aggregate", async () => {
    const store = createInMemoryTraceStore();
    store.add(makeTrace({ traceId: "t1", status: "completed" }));
    store.add(makeTrace({ traceId: "t2", status: "failed" }));
    const handle = await start(store);

    const res = await fetch(`${handle.url}api/aggregate`);
    const body = (await res.json()) as { traces: number; completed: number; failed: number };

    expect(res.status).toBe(200);
    expect(body.traces).toBe(2);
    expect(body.completed).toBe(1);
    expect(body.failed).toBe(1);
  });

  it("returns one trace on GET /api/traces/:id", async () => {
    const store = createInMemoryTraceStore();
    store.add(makeTrace({ traceId: "abc" }));
    const handle = await start(store);

    const res = await fetch(`${handle.url}api/traces/abc`);
    const body = (await res.json()) as { traceId: string };

    expect(res.status).toBe(200);
    expect(body.traceId).toBe("abc");
  });

  it("returns 404 on a missing trace id", async () => {
    const handle = await start();

    const res = await fetch(`${handle.url}api/traces/nope`);

    expect(res.status).toBe(404);
  });

  it("serves the HTML page on GET /", async () => {
    const handle = await start();

    const res = await fetch(handle.url);
    const text = await res.text();

    expect(res.headers.get("content-type")).toContain("text/html");
    expect(text).toContain("Panoptic");
  });

  it("close() releases the port so a new server can bind it", async () => {
    const first = await dashboard(createInMemoryTraceStore(), { port: 0 });
    const port = first.port;
    await first.close();

    // Re-binding the just-released port must succeed.
    const second = await dashboard(createInMemoryTraceStore(), { port });
    handles.push(second);

    expect(second.port).toBe(port);
  });

  it("rejects with a clear message when the port is already in use", async () => {
    const first = await start();

    await expect(dashboard(createInMemoryTraceStore(), { port: first.port })).rejects.toThrow(
      /port .* in use/,
    );
  });
});
