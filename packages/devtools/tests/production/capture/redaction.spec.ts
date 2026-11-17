import { describe, expect, it } from "vitest";
import { toStoredSample } from "../../../src/production/capture";
import { scrubQueryError } from "../../../src/production/capture/redact";
import type { DevtoolsRequest, DevtoolsStreamEvent } from "../../../src/types";
import { createEngine, queryEvent, SECRET, traced } from "./helpers";

function seededRequest(): DevtoolsRequest {
  return {
    id: "req-1",
    method: "POST",
    path: `/login?token=${SECRET}`,
    route: "/login",
    status: 500,
    startedAt: 10,
    durationMs: 40,
    error: "boom",
    phases: [{ name: "handler", startedAt: 11, durationMs: 5, attrs: { secret: SECRET } }],
    queries: [
      {
        id: "q1",
        connection: "default",
        driver: "postgres",
        sql: `SELECT * FROM users WHERE token = '${SECRET}' AND id = $1`,
        bindings: [SECRET],
        startedAt: 12,
        durationMs: 2,
        shape: "SELECT * FROM users WHERE token = ? AND id = $1",
        caller: { file: `/srv/${SECRET}/app.ts`, line: 1, column: 1 },
        error: `duplicate key { email: "${SECRET}" } for 'x${SECRET}'`,
      },
      {
        id: "q2",
        connection: "default",
        driver: "mongodb",
        collection: "users",
        command: "find",
        pipeline: { find: "users", filter: { token: SECRET } },
        startedAt: 13,
        durationMs: 1,
        shape: 'users.find {"find":"?","filter":{"token":"?"}}',
      },
    ],
    cache: [
      { type: "hit", driver: "memory", key: SECRET, tags: [SECRET], keys: [SECRET], at: 1 },
      { type: "miss", driver: "memory", key: SECRET, at: 2 },
      { type: "set", driver: "memory", key: SECRET, at: 3 },
    ],
    logs: [
      {
        level: "warn",
        module: "auth",
        action: "login",
        message: "failed",
        at: 14,
        context: { password: SECRET },
      },
    ],
    mails: [],
    warnings: [
      {
        type: "n+1",
        message: "N+1",
        shape: "SELECT ?",
        count: 6,
        caller: { file: `/srv/${SECRET}/x.ts`, line: 2, column: 2 },
      },
    ],
  };
}

describe("toStoredSample", () => {
  it("removes every value from a request that carries them all", () => {
    const sample = toStoredSample(seededRequest(), "host:1:abc", 3);
    const json = JSON.stringify(sample);

    expect(json).not.toContain(SECRET);
    expect(sample.summary.path).toBe("/login");
    expect(sample.summary.queryCount).toBe(5);
    expect(sample.detail?.queries[0]).toMatchObject({
      sql: "SELECT * FROM users WHERE token = ? AND id = $1",
      shape: "SELECT * FROM users WHERE token = ? AND id = $1",
    });
    expect(sample.detail?.cache).toEqual({ hits: 1, misses: 1, writes: 1 });
    expect(sample.detail?.phases[0]).toEqual({ name: "handler", startedAt: 11, durationMs: 5 });
    expect(sample.detail?.logs[0]).not.toHaveProperty("context");
    expect(sample.detail?.droppedQueries).toBe(3);
    expect(sample.instance).toBe("host:1:abc");
  });

  it("scrubs quoted values and documents out of a database error", () => {
    expect(scrubQueryError(`E11000 dup key: { email: "${SECRET}" } 'a@b.co' x@y.io`)).toBe(
      "E11000 dup key: {?} ? ?",
    );
  });
});

describe("what leaves the capture", () => {
  it("keeps the secret out of samples, answers, statistics and stream events", async () => {
    const { engine, store } = createEngine();
    const events: DevtoolsStreamEvent[] = [];

    engine.collector.subscribe((event) => events.push(event));

    const request = traced("req-9", "/orders/1?secret=" + SECRET);

    engine.hooks.onRequestStart(request);
    engine.hooks.onPhase(request, {
      name: "handler",
      durationMs: 4,
      attrs: { secret: SECRET },
    } as never);
    engine.hooks.onQuery(
      "req-9",
      queryEvent({
        sql: `SELECT * FROM orders WHERE note = '${SECRET}' AND id = $1`,
        bindings: [SECRET],
        durationMs: 250,
        error: `violates "${SECRET}"`,
      }),
    );
    engine.hooks.onQuery(
      "req-9",
      queryEvent({
        driver: "mongodb",
        sql: undefined as never,
        bindings: undefined as never,
        collection: "orders",
        command: "find",
        pipeline: { find: "orders", filter: { token: SECRET } },
      }),
    );
    engine.hooks.onLog("req-9", {
      level: "error",
      module: "orders",
      action: "save",
      message: "could not save",
      at: 5,
      context: { card: SECRET },
    } as never);
    engine.hooks.onCache("req-9", {
      type: "hit",
      driver: "memory",
      key: SECRET,
      tags: [SECRET],
      at: 6,
    });
    engine.hooks.onRequestEnd(request, { status: 500, durationMs: 30, error: new Error("boom") });

    await engine.flush();

    const stored = await store?.samples.get("req-9");
    const listed = await engine.requests.list({ limit: 10 });
    const detail = await engine.requests.get("req-9");
    const inMemory = [...(engine.collector.getRequest("req-9")?.queries ?? [])];
    const answers = JSON.stringify({
      stored,
      listed,
      detail,
      events,
      queries: engine.queries.snapshot(50),
      routes: engine.routes.snapshot(50),
      errors: engine.errors.snapshot(50),
      logs: engine.logs.snapshot(50),
      counters: engine.counters(),
    });

    expect(answers).not.toContain(SECRET);
    expect(stored?.detail?.queries).toHaveLength(2);
    // The ring keeps shapes, not statements or bindings.
    expect(inMemory.every((query) => query.sql === undefined && query.bindings === undefined)).toBe(
      true,
    );
    expect(JSON.stringify(engine.collector.getRequest("req-9"))).not.toContain(SECRET);
  });

  it("keeps the slowest example, with its bindings, in memory only", () => {
    const { engine } = createEngine();
    const request = traced("req-2");

    engine.hooks.onRequestStart(request);
    engine.hooks.onQuery("req-2", queryEvent({ bindings: [SECRET], durationMs: 90 }));
    engine.hooks.onRequestEnd(request, { status: 200, durationMs: 100 });

    const [shape] = engine.queries.snapshot(1);

    expect(JSON.stringify(shape)).not.toContain(SECRET);
    expect(engine.queries.example(shape?.id ?? "")?.bindings).toEqual([SECRET]);
  });
});
