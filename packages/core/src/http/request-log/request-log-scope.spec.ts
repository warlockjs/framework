import { afterEach, describe, expect, it } from "vitest";
import {
  beginRequestLogScope,
  endRequestLogScope,
  errorFromLogData,
  hasRequestLogScope,
  recordLoggedRequestLogError,
  recordRequestLogEntry,
  recordRequestLogError,
  recordRequestLogPhase,
  recordRequestLogQuery,
  resetRequestLogScopesForTests,
  resolveScopeError,
  summarizeScopeQueries,
  toRequestLogEntry,
  toRequestLogError,
} from "./request-log-scope";
import { requestLogQueryShape } from "./query-shape";

afterEach(() => resetRequestLogScopesForTests());

describe("request log scope", () => {
  it("collects entries per request and drops the scope on end", () => {
    beginRequestLogScope("a");
    beginRequestLogScope("b");
    recordRequestLogEntry("a", { level: "info", module: "m", action: "x", message: "one", at: 1 });
    recordRequestLogPhase("a", { name: "handler", durationMs: 3 });

    const scope = endRequestLogScope("a");

    expect(scope?.logs).toHaveLength(1);
    expect(scope?.phases).toEqual([{ name: "handler", durationMs: 3 }]);
    expect(hasRequestLogScope("a")).toBe(false);
    expect(hasRequestLogScope("b")).toBe(true);
  });

  it("ignores records for requests that are not tracked", () => {
    recordRequestLogEntry("nope", { level: "info", module: "m", action: "x", message: "x", at: 1 });
    recordRequestLogQuery("nope", { sql: "select 1", durationMs: 1 });

    expect(endRequestLogScope("nope")).toBeUndefined();
  });

  it("caps the log entries of one request", () => {
    beginRequestLogScope("a");

    for (let index = 0; index < 250; index++) {
      recordRequestLogEntry("a", {
        level: "info",
        module: "m",
        action: "x",
        message: `${index}`,
        at: index,
      });
    }

    const scope = endRequestLogScope("a");

    expect(scope?.logs).toHaveLength(200);
    expect(scope?.droppedLogs).toBe(50);
  });

  it("summarises queries: count, slowest and N+1 shapes", () => {
    beginRequestLogScope("a");

    for (let id = 1; id <= 6; id++) {
      recordRequestLogQuery("a", {
        sql: `select * from users where id = ${id}`,
        durationMs: id,
      });
    }

    recordRequestLogQuery("a", { collection: "posts", command: "find", durationMs: 40 });

    const queries = summarizeScopeQueries(endRequestLogScope("a")!);

    expect(queries).toEqual({
      count: 7,
      slowest: { durationMs: 40, query: "posts.find" },
      nPlusOne: [{ query: "select * from users where id = ?", count: 6 }],
    });
  });

  it("has no queries summary when none ran", () => {
    beginRequestLogScope("a");

    expect(summarizeScopeQueries(endRequestLogScope("a")!)).toBeUndefined();
  });

  it("prefers the thrown error over a logged one", () => {
    beginRequestLogScope("a");
    recordLoggedRequestLogError("a", { message: "logged", name: "Error" });

    expect(resolveScopeError(endRequestLogScope("a")!)?.message).toBe("logged");

    beginRequestLogScope("b");
    recordLoggedRequestLogError("b", { message: "logged", name: "Error" });
    recordRequestLogError("b", new RangeError("thrown"));

    expect(resolveScopeError(endRequestLogScope("b")!)).toMatchObject({
      message: "thrown",
      name: "RangeError",
    });
  });
});

describe("error records", () => {
  it("builds one from an Error", () => {
    expect(toRequestLogError(new TypeError("bad"))).toMatchObject({
      message: "bad",
      name: "TypeError",
    });
  });

  it("reads the page error record from an error log entry", () => {
    const error = errorFromLogData({
      type: "error",
      module: "web",
      action: "page.render",
      message: "Render failed: boom",
      context: {
        name: "TypeError",
        message: "boom",
        stack: "TypeError: boom\n    at page.tsx:3:1",
        phase: "render",
        file: "src/app/home.page.tsx",
        site: "main",
        requestId: "r1",
      },
    });

    expect(error).toEqual({
      message: "boom",
      name: "TypeError",
      stack: "TypeError: boom\n    at page.tsx:3:1",
      phase: "render",
      file: "src/app/home.page.tsx",
      site: "main",
    });
  });

  it("reads an Error message from an error log entry", () => {
    expect(
      errorFromLogData({
        type: "error",
        module: "http",
        action: "request-error",
        message: new Error("db down"),
      }),
    ).toMatchObject({ message: "db down", name: "Error" });
  });

  it("ignores entries that are not errors or carry no error", () => {
    expect(
      errorFromLogData({ type: "info", module: "a", action: "b", message: new Error("x") }),
    ).toBeUndefined();
    expect(
      errorFromLogData({ type: "error", module: "a", action: "b", message: "plain" }),
    ).toBeUndefined();
  });
});

describe("toRequestLogEntry", () => {
  it("drops the request snapshot and keeps small context", () => {
    const entry = toRequestLogEntry(
      {
        type: "warn",
        module: "billing",
        action: "charge",
        message: "declined",
        context: { request: { id: "r" }, orderId: 9 },
      },
      5,
    );

    expect(entry).toEqual({
      level: "warn",
      module: "billing",
      action: "charge",
      message: "declined",
      at: 5,
      context: { orderId: 9 },
    });
  });

  it("omits large context", () => {
    const entry = toRequestLogEntry({
      type: "info",
      module: "a",
      action: "b",
      message: "m",
      context: { blob: "x".repeat(5000) },
    });

    expect(entry).not.toHaveProperty("context");
  });
});

describe("requestLogQueryShape", () => {
  it("strips literals from SQL", () => {
    expect(
      requestLogQueryShape({
        sql: "SELECT * FROM users WHERE email = 'a@b.c' AND id IN (1, 2, 3) AND age > 18.5",
        durationMs: 1,
      }),
    ).toBe("SELECT * FROM users WHERE email = ? AND id IN (?) AND age > ?");
  });

  it("names document queries by collection and command", () => {
    expect(requestLogQueryShape({ collection: "posts", command: "find", durationMs: 1 })).toBe(
      "posts.find",
    );
    expect(requestLogQueryShape({ durationMs: 1 })).toBe("unknown");
  });
});
