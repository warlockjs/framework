import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RequestLogRecord } from "../../../http/request-log/request-log.types";
import { logsCommand } from "../logs.command";
import {
  formatRequestLogRecord,
  formatRequestLogRows,
  runLogsCommand,
} from "./logs-command.action";

let directory: string;

function record(id: string, overrides: Partial<RequestLogRecord> = {}): RequestLogRecord {
  return {
    type: "request",
    id,
    traceId: id,
    time: new Date().toISOString(),
    method: "GET",
    url: "/posts",
    route: { pattern: "/posts", name: "posts.list" },
    status: 200,
    durationMs: 8,
    response: {},
    ...overrides,
  };
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "logs-command-"));

  const records = [
    record("ok", { time: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }),
    record("missing", { status: 404, url: "/nope", route: {} }),
    record("broken", {
      status: 500,
      route: { pattern: "/users/:id", name: "users.show" },
      error: { message: "db down", name: "Error", stack: "Error: db down\n    at repo.ts:1:1", phase: "loader" },
      logs: [{ level: "error", module: "http", action: "request-error", message: "db down", at: 1 }],
      queries: { count: 6, slowest: { durationMs: 20, query: "select ?" }, nPlusOne: [{ query: "select ?", count: 6 }] },
      phases: [{ name: "handler", durationMs: 7 }],
    }),
  ];

  fs.writeFileSync(
    path.join(directory, `${new Date().toISOString().slice(0, 10)}.jsonl`),
    records.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("warlock logs requests", () => {
  it("lists newest first", async () => {
    const result = await runLogsCommand(["requests"], {}, { directory });

    expect(result.exitCode).toBe(0);
    expect((result.json as Array<{ id: string }>).map((row) => row.id)).toEqual(["broken", "missing", "ok"]);
    expect(result.lines[0]).toContain("broken");
    expect(result.lines[0]).toContain("! db down");
  });

  it("filters by status class and exact status", async () => {
    const server = await runLogsCommand(["requests"], { status: "5xx" }, { directory });
    const notFound = await runLogsCommand(["requests"], { status: 404 }, { directory });

    expect((server.json as Array<{ id: string }>).map((row) => row.id)).toEqual(["broken"]);
    expect((notFound.json as Array<{ id: string }>).map((row) => row.id)).toEqual(["missing"]);
  });

  it("filters by route and since", async () => {
    const route = await runLogsCommand(["requests"], { route: "users.show" }, { directory });
    const since = await runLogsCommand(["requests"], { since: "1h" }, { directory });

    expect((route.json as Array<{ id: string }>).map((row) => row.id)).toEqual(["broken"]);
    expect((since.json as Array<{ id: string }>).map((row) => row.id)).toEqual(["broken", "missing"]);
  });

  it("limits the list", async () => {
    const result = await runLogsCommand(["requests"], { limit: "1" }, { directory });

    expect(result.json).toHaveLength(1);
  });

  it("rejects a bad limit, status or since with exit code 1", async () => {
    for (const options of [{ limit: "0" }, { limit: "x" }, { status: "teapot" }, { since: "soon" }]) {
      const result = await runLogsCommand(["requests"], options, { directory });

      expect(result.exitCode).toBe(1);
    }
  });

  it("says so when nothing matches", async () => {
    const result = await runLogsCommand(["requests"], { status: "3xx" }, { directory });

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["No requests found."]);
  });
});

describe("warlock logs request <id>", () => {
  it("prints one request in full", async () => {
    const result = await runLogsCommand(["request", "broken"], {}, { directory });
    const text = result.lines.join("\n");

    expect(result.exitCode).toBe(0);
    expect((result.json as RequestLogRecord).id).toBe("broken");
    expect(text).toContain("GET /posts -> 500");
    expect(text).toContain("Error: Error: db down  (loader)");
    expect(text).toContain("at repo.ts:1:1");
    expect(text).toContain("N+1 x6  select ?");
    expect(text).toContain("[error] http.request-error  db down");
    expect(text).toContain("handler  7ms");
  });

  it("fails for an unknown id, a missing id and an unknown action", async () => {
    expect((await runLogsCommand(["request", "zzz"], {}, { directory })).exitCode).toBe(1);
    expect((await runLogsCommand(["request"], {}, { directory })).exitCode).toBe(1);
    expect((await runLogsCommand(["tail"], {}, { directory })).exitCode).toBe(1);
  });
});

describe("formatters", () => {
  it("formats an empty list", () => {
    expect(formatRequestLogRows([])).toEqual(["No requests found."]);
  });

  it("formats a record without optional parts", () => {
    expect(formatRequestLogRecord(record("a")).join("\n")).toContain("GET /posts -> 200");
  });
});

describe("registration", () => {
  it("declares the logs command with its options", () => {
    expect(logsCommand.name).toBe("logs <action> [id]");
    expect(logsCommand.commandOptions.map((option) => option.name)).toEqual(
      expect.arrayContaining(["status", "route", "since", "limit", "json"]),
    );
  });

  it("is listed in the framework commands", () => {
    const registry = fs.readFileSync(fileURLToPath(new URL("../../framework-cli-commands.ts", import.meta.url)), "utf8");

    expect(registry).toMatch(/frameworkCommands = \[[\s\S]*logsCommand,/);
  });
});
