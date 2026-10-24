import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compileRequestLogFilter,
  getRequestLog,
  listRequestLogs,
  parseRequestLogStatusFilter,
  parseRequestLogTime,
  requestLogToCurl,
  summarizeRequestLog,
} from "./request-log-store";
import type { RequestLogRecord } from "./request-log.types";

const now = Date.UTC(2026, 9, 24, 12, 0, 0);
let directory: string;

function record(overrides: Partial<RequestLogRecord> & { id: string }): RequestLogRecord {
  return {
    type: "request",
    traceId: overrides.id,
    time: new Date(now).toISOString(),
    method: "GET",
    url: "/posts",
    route: { pattern: "/posts", name: "posts.list" },
    status: 200,
    durationMs: 5,
    response: {},
    ...overrides,
  };
}

function writeDay(day: string, records: RequestLogRecord[], extra: string[] = []): void {
  fs.writeFileSync(
    path.join(directory, `${day}.jsonl`),
    [...records.map((entry) => JSON.stringify(entry)), ...extra].join("\n") + "\n",
  );
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "request-log-store-"));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("filters", () => {
  it("parses statuses and classes", () => {
    expect(parseRequestLogStatusFilter("5xx")).toEqual({ class: 5 });
    expect(parseRequestLogStatusFilter(404)).toEqual({ exact: 404 });
    expect(() => parseRequestLogStatusFilter("oops")).toThrow(/Invalid status filter/);
  });

  it("parses durations, ISO dates and epoch milliseconds", () => {
    expect(parseRequestLogTime("30m", now)).toBe(now - 30 * 60 * 1000);
    expect(parseRequestLogTime("2d", now)).toBe(now - 2 * 24 * 60 * 60 * 1000);
    expect(parseRequestLogTime("2026-10-24T00:00:00.000Z")).toBe(Date.UTC(2026, 9, 24));
    expect(parseRequestLogTime(1234)).toBe(1234);
    expect(() => parseRequestLogTime("later")).toThrow(/Invalid time/);
  });

  it("matches rows by status, route, method, time and text", () => {
    const row = summarizeRequestLog(
      record({ id: "abc123", method: "POST", url: "/posts?x=1", status: 503, time: new Date(now - 10 * 60 * 1000).toISOString() }),
    );

    expect(compileRequestLogFilter({ status: "5xx" }, now)(row)).toBe(true);
    expect(compileRequestLogFilter({ status: 503 }, now)(row)).toBe(true);
    expect(compileRequestLogFilter({ status: "4xx" }, now)(row)).toBe(false);
    expect(compileRequestLogFilter({ route: "posts.list" }, now)(row)).toBe(true);
    expect(compileRequestLogFilter({ route: "/users" }, now)(row)).toBe(false);
    expect(compileRequestLogFilter({ method: "post" }, now)(row)).toBe(true);
    expect(compileRequestLogFilter({ since: "1h" }, now)(row)).toBe(true);
    expect(compileRequestLogFilter({ since: "5m" }, now)(row)).toBe(false);
    expect(compileRequestLogFilter({ until: now - 20 * 60 * 1000 }, now)(row)).toBe(false);
    expect(compileRequestLogFilter({ q: "X=1" }, now)(row)).toBe(true);
    expect(compileRequestLogFilter({ q: "ABC1" }, now)(row)).toBe(true);
    expect(compileRequestLogFilter({ q: "nothing" }, now)(row)).toBe(false);
  });
});

describe("listRequestLogs", () => {
  it("returns an empty list when nothing was written", async () => {
    expect(await listRequestLogs({}, { directory })).toEqual([]);
    expect(await listRequestLogs({}, { directory: path.join(directory, "missing") })).toEqual([]);
  });

  it("lists newest first across days and skips damaged lines", async () => {
    writeDay("2026-10-23", [record({ id: "old", time: "2026-10-23T10:00:00.000Z" })]);
    writeDay(
      "2026-10-24",
      [
        record({ id: "a", time: "2026-10-24T10:00:00.000Z" }),
        record({ id: "b", time: "2026-10-24T11:00:00.000Z", status: 500, error: { message: "boom", name: "Error" } }),
      ],
      ['{"type":"request","id":"half'],
    );

    const rows = await listRequestLogs({}, { directory });

    expect(rows.map((row) => row.id)).toEqual(["b", "a", "old"]);
    expect(rows[0]).toMatchObject({ status: 500, error: "boom", route: "/posts", routeName: "posts.list" });
  });

  it("filters and limits", async () => {
    writeDay("2026-10-24", [
      record({ id: "a", status: 200 }),
      record({ id: "b", status: 500 }),
      record({ id: "c", status: 404, url: "/missing" }),
      record({ id: "d", status: 502 }),
    ]);

    expect((await listRequestLogs({ status: "5xx" }, { directory })).map((row) => row.id)).toEqual(["d", "b"]);
    expect((await listRequestLogs({ status: 404 }, { directory })).map((row) => row.id)).toEqual(["c"]);
    expect((await listRequestLogs({ limit: 2 }, { directory })).map((row) => row.id)).toEqual(["d", "c"]);
  });
});

describe("getRequestLog", () => {
  it("opens one record by id, or undefined", async () => {
    writeDay("2026-10-24", [
      record({ id: "a" }),
      record({ id: "b", logs: [{ level: "info", module: "m", action: "a", message: "hi", at: 1 }], queries: { count: 2 } }),
    ]);

    expect(await getRequestLog("b", { directory })).toMatchObject({
      id: "b",
      logs: [{ message: "hi" }],
      queries: { count: 2 },
    });
    expect(await getRequestLog("zzz", { directory })).toBeUndefined();
  });
});

describe("requestLogToCurl", () => {
  it("builds a curl command that keeps redacted values redacted", () => {
    const curl = requestLogToCurl(
      record({
        id: "a",
        method: "POST",
        url: "/login?next=%2F&token=[REDACTED]",
        headers: {
          host: "api.example.com",
          "x-forwarded-proto": "https",
          "content-type": "application/json",
          authorization: "[REDACTED]",
          "content-length": "20",
        },
        body: { email: "a@b.c", password: "[REDACTED]", note: "it's" },
      }),
    );

    expect(curl).toBe(
      [
        "curl -X POST 'https://api.example.com/login?next=%2F&token=[REDACTED]'",
        "-H 'x-forwarded-proto: https'",
        "-H 'content-type: application/json'",
        "-H 'authorization: [REDACTED]'",
        `--data-raw '{"email":"a@b.c","password":"[REDACTED]","note":"it'\\''s"}'`,
      ].join(" "),
    );
  });

  it("falls back to the base URL without a host header", () => {
    expect(requestLogToCurl(record({ id: "a" }), "http://localhost:2030/")).toBe(
      "curl -X GET 'http://localhost:2030/posts'",
    );
  });
});
