import {
  dispatchPhase,
  dispatchRequestEnd,
  dispatchRequestStart,
  resetTracingConfigForTests,
  resetMailConfig,
  sendMail,
  setMailMode,
  type TracingContext,
} from "@warlock.js/core";
import { cache, MemoryCacheDriver } from "@warlock.js/cache";
import { dataSourceRegistry } from "@warlock.js/cascade";
import { log } from "@warlock.js/logger";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { attachCacheSource } from "../src/sources/cache-source";
import { attachLogSource } from "../src/sources/log-source";
import { attachMailSource } from "../src/sources/mail-source";
import { attachQuerySource } from "../src/sources/query-source";
import { attachTracingSource } from "../src/sources/tracing-source";
import type {
  DevtoolsCacheOperation,
  DevtoolsCollector,
  DevtoolsLogEntry,
  DevtoolsMail,
  DevtoolsPhase,
  DevtoolsQuery,
  DevtoolsRequest,
  ResolvedDevtoolsOptions,
} from "../src/types";

/** A minimal in-test collector that only records what each source hands it. */
function createFakeCollector() {
  const started: { id: string; requestId?: string }[] = [];
  const ended: { id: string; result: unknown }[] = [];
  const phases: { requestId: string; phase: DevtoolsPhase }[] = [];
  const queries: { requestId: string | undefined; query: Omit<DevtoolsQuery, "id" | "shape"> }[] =
    [];
  const cacheOps: { requestId: string | undefined; operation: DevtoolsCacheOperation }[] = [];
  const logs: { requestId: string | undefined; entry: DevtoolsLogEntry }[] = [];
  const mails: DevtoolsMail[] = [];

  const collector: DevtoolsCollector = {
    startRequest(request) {
      started.push({ id: request.id });
    },
    endRequest(id, result) {
      ended.push({ id, result });
    },
    addPhase(requestId, phase) {
      phases.push({ requestId, phase });
    },
    addQuery(requestId, query) {
      queries.push({ requestId, query });
      return { ...query, id: "q1", shape: "shape" };
    },
    addCacheOperation(requestId, operation) {
      cacheOps.push({ requestId, operation });
    },
    addLog(requestId, entry) {
      logs.push({ requestId, entry });
    },
    addMail(mail) {
      mails.push(mail);
    },
    listRequests: () => [],
    getRequest: () => undefined as DevtoolsRequest | undefined,
    listMails: () => [],
    getMail: () => undefined,
    listLogs: () => [],
    getBackground: () => ({ queries: [], cache: [], logs: [] }),
    subscribe: () => () => {},
    clear: () => {},
  };

  return { collector, started, ended, phases, queries, cacheOps, logs, mails };
}

const options: ResolvedDevtoolsOptions = {
  path: "/__warlock",
  maxRequests: 200,
  nPlusOneThreshold: 5,
};

describe("attachTracingSource", () => {
  beforeEach(() => resetTracingConfigForTests());
  afterEach(() => resetTracingConfigForTests());

  const ctx: TracingContext = {
    traceId: "trace-1",
    requestId: "req-1",
    method: "GET",
    route: "/things/:id",
    path: "/things/42",
  };

  it("maps request start, phase and end into the collector", async () => {
    const { collector, started, phases, ended } = createFakeCollector();
    const dispose = await attachTracingSource(collector, options);

    dispatchRequestStart(ctx);
    dispatchPhase(ctx, { name: "render", durationMs: 5, startedAt: 10, attrs: { ok: true } });
    dispatchRequestEnd(ctx, { status: 200, durationMs: 12 });

    expect(started).toEqual([{ id: "req-1" }]);
    expect(phases).toEqual([
      {
        requestId: "req-1",
        phase: { name: "render", durationMs: 5, startedAt: 10, attrs: { ok: true } },
      },
    ]);
    expect(ended).toEqual([
      {
        id: "req-1",
        result: { status: 200, durationMs: 12, error: undefined, route: "/things/:id" },
      },
    ]);

    dispose();
  });

  it("never records requests to the dashboard's own path", async () => {
    const { collector, started, phases, ended } = createFakeCollector();
    const dispose = await attachTracingSource(collector, options);
    const dashboardCtx: TracingContext = { ...ctx, path: "/__warlock/api/requests" };

    dispatchRequestStart(dashboardCtx);
    dispatchPhase(dashboardCtx, { name: "render", durationMs: 1 });
    dispatchRequestEnd(dashboardCtx, { durationMs: 1 });

    expect(started).toEqual([]);
    expect(phases).toEqual([]);
    expect(ended).toEqual([]);

    dispose();
  });

  it("stops delivering after the disposer runs", async () => {
    const { collector, started } = createFakeCollector();
    const dispose = await attachTracingSource(collector, options);
    dispose();

    dispatchRequestStart(ctx);

    expect(started).toEqual([]);
  });
});

describe("attachQuerySource", () => {
  it("maps a settled query, redacting bindings, and stops after dispose", async () => {
    const { collector, queries } = createFakeCollector();
    const dispose = await attachQuerySource(collector);

    const driver = new EventEmitter() as unknown as { on: any; off: any; emit: any };
    const source = dataSourceRegistry.register({ name: "devtools-test", driver: driver as any });

    driver.emit("query", {
      driver: "postgres",
      sql: "SELECT * FROM users WHERE id = $1",
      bindings: [{ password: "secret" }],
      startedAt: 1,
      durationMs: 2,
      rowCount: 1,
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]?.query).toMatchObject({
      connection: "devtools-test",
      driver: "postgres",
      sql: "SELECT * FROM users WHERE id = $1",
      rowCount: 1,
    });
    expect((queries[0]?.query.bindings?.[0] as { password: string }).password).toBe("[REDACTED]");

    dispose();
    driver.emit("query", {
      driver: "postgres",
      sql: "SELECT 1",
      startedAt: 1,
      durationMs: 1,
    });

    expect(queries).toHaveLength(1);
    dataSourceRegistry.unregister(source);
  });
});

describe("attachCacheSource", () => {
  afterEach(async () => {
    await cache.flush().catch(() => undefined);
  });

  it("maps a cache set into the collector and stops after dispose", async () => {
    const driver = new MemoryCacheDriver();
    driver.setOptions({});
    await cache.use(driver);
    const { collector, cacheOps } = createFakeCollector();
    const dispose = await attachCacheSource(collector);

    await cache.set("devtools-key", "value");

    expect(cacheOps).toMatchObject([
      { operation: { type: "set", driver: "memory", key: "devtools-key" } },
    ]);

    dispose();
    await cache.set("devtools-key-2", "value");

    expect(cacheOps).toHaveLength(1);
  });
});

describe("attachMailSource", () => {
  afterEach(() => resetMailConfig());

  it("maps a captured mail, stripping attachment bytes, and stops after dispose", async () => {
    setMailMode("development");
    const { collector, mails } = createFakeCollector();
    const dispose = await attachMailSource(collector);

    await sendMail({
      id: "devtools-mail-1",
      to: "user@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      attachments: [{ filename: "note.txt", contentType: "text/plain", content: "hello" }],
    });

    expect(mails).toHaveLength(1);
    const mail = mails[0]!;
    expect(mail.id).toBe("devtools-mail-1");
    expect(mail.to).toEqual(["user@example.com"]);
    expect(mail.attachments).toEqual([
      { filename: "note.txt", contentType: "text/plain", size: 5 },
    ]);
    expect(mail.attachments[0]).not.toHaveProperty("content");

    dispose();
    await sendMail({
      id: "devtools-mail-2",
      to: "user@example.com",
      subject: "Bye",
      html: "<p>Bye</p>",
    });

    expect(mails).toHaveLength(1);
  });
});

describe("attachLogSource", () => {
  it("maps a log entry, redacts context, and ignores further entries after dispose", async () => {
    const { collector, logs } = createFakeCollector();
    const dispose = await attachLogSource(collector);

    await log.warn("devtools-test", "action", "something happened", { password: "secret" });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.entry).toMatchObject({
      level: "warn",
      module: "devtools-test",
      action: "action",
    });
    expect((logs[0]?.entry.context as { password: string }).password).toBe("[REDACTED]");

    dispose();
    await log.error("devtools-test", "action-2", "ignored");

    expect(logs).toHaveLength(1);
  });
});
