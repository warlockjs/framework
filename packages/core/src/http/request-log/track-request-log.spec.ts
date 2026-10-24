import { EventEmitter } from "node:events";
import config from "@mongez/config";
import { LogChannel, log, type LoggingData } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "../request";
import {
  RequestLogCollectorChannel,
  resetRequestLogRuntimeForTests,
  startRequestLog,
} from "./request-log-runtime";
import {
  beginRequestLogScope,
  endRequestLogScope,
  recordLoggedRequestLogError,
  recordRequestLogEntry,
  recordRequestLogError,
  resetRequestLogScopesForTests,
} from "./request-log-scope";
import { isRequestLogEnabled, resetRequestLogConfigForTests } from "./resolve-request-log-config";
import { finishRequestLog, resetRequestLogWriterForTests, trackRequestLog } from "./track-request-log";
import type { RequestLogRecord } from "./request-log.types";

class CaptureChannel extends LogChannel {
  public override name = "capture";
  public records: RequestLogRecord[] = [];
  public entries: LoggingData[] = [];

  public log(data: LoggingData): void {
    this.entries.push(data);
    this.records.push(data.context as unknown as RequestLogRecord);
  }
}

class ThrowingChannel extends LogChannel {
  public override name = "throwing";

  public log(): void {
    throw new Error("disk full");
  }
}

function fakeRequest(): Request {
  return {
    id: "r1",
    traceId: "t1",
    baseRequest: { method: "POST", url: "/posts?token=abc&page=2" },
    route: { path: "/posts", name: "posts.create", method: "POST" },
    params: {},
    query: { token: "abc", page: "2" },
    headers: { accept: "*/*", cookie: "sid=1" },
    body: { title: "Hi", password: "hunter2" },
    locals: { user: { id: 5, userType: "admin" } },
    userAgent: "vitest",
    detectIp: () => "1.2.3.4",
    response: {
      getHeaders: () => ({ "content-type": "application/json" }),
      getHeader: () => undefined,
      body: { ok: true },
    },
  } as unknown as Request;
}

function useConfig(requests: Record<string, unknown>): void {
  config.set("http.logging", { requests });
  resetRequestLogConfigForTests();
}

let capture: CaptureChannel;

beforeEach(() => {
  capture = new CaptureChannel();
});

afterEach(() => {
  config.set("http.logging", undefined);
  resetRequestLogConfigForTests();
  resetRequestLogRuntimeForTests();
  resetRequestLogScopesForTests();
  resetRequestLogWriterForTests();
  vi.restoreAllMocks();
});

describe("finishRequestLog", () => {
  it("writes one redacted record to the configured channels", () => {
    useConfig({ enabled: true, only: "all", channels: [capture], include: { body: true } });
    beginRequestLogScope("r1");
    recordRequestLogEntry("r1", { level: "info", module: "app", action: "x", message: "hello", at: 1 });

    finishRequestLog(fakeRequest(), { statusCode: 201 }, endRequestLogScope("r1"), Date.UTC(2026, 0, 1), 12);

    expect(capture.records).toHaveLength(1);
    expect(capture.entries[0]).toMatchObject({ module: "http", action: "request", type: "info" });

    const [record] = capture.records;

    expect(record).toMatchObject({
      type: "request",
      id: "r1",
      traceId: "t1",
      method: "POST",
      url: "/posts?token=[REDACTED]&page=2",
      route: { name: "posts.create", pattern: "/posts" },
      query: { token: "[REDACTED]", page: "2" },
      body: { title: "Hi", password: "[REDACTED]" },
      session: { userId: 5, userType: "admin" },
      ip: "1.2.3.4",
      status: 201,
      durationMs: 12,
      logs: [{ message: "hello" }],
      phases: [{ name: "handler", durationMs: 12 }],
    });
    expect(record?.headers).toEqual({ accept: "*/*" });
  });

  it("attaches the logged error to a 5xx record and logs it at error level", () => {
    useConfig({ enabled: true, only: "errors", channels: [capture] });
    beginRequestLogScope("r1");
    recordLoggedRequestLogError("r1", {
      message: "render failed",
      name: "TypeError",
      stack: "TypeError: render failed\n    at home.page.tsx:1:1",
      phase: "render",
      file: "src/app/home.page.tsx",
      site: "main",
    });

    finishRequestLog(fakeRequest(), { statusCode: 500 }, endRequestLogScope("r1"), Date.now(), 30);

    expect(capture.entries[0]?.type).toBe("error");
    expect(capture.records[0]?.error).toMatchObject({
      message: "render failed",
      phase: "render",
      file: "src/app/home.page.tsx",
      site: "main",
    });
  });

  it("keeps a thrown request even when the response status is not 5xx", () => {
    useConfig({ enabled: true, only: "errors", channels: [capture] });
    beginRequestLogScope("r1");
    recordRequestLogError("r1", new Error("threw"));

    finishRequestLog(fakeRequest(), { statusCode: 200 }, endRequestLogScope("r1"), Date.now(), 3);

    expect(capture.records[0]?.error?.message).toBe("threw");
  });

  it("writes nothing for a request the filters drop", () => {
    useConfig({ enabled: true, only: "errors", channels: [capture] });

    finishRequestLog(fakeRequest(), { statusCode: 200 }, undefined, Date.now(), 3);

    expect(capture.records).toEqual([]);
  });

  it("does not attach an error to a successful request", () => {
    useConfig({ enabled: true, only: "all", channels: [capture] });
    beginRequestLogScope("r1");
    recordLoggedRequestLogError("r1", { message: "handled", name: "Error" });

    finishRequestLog(fakeRequest(), { statusCode: 200 }, endRequestLogScope("r1"), Date.now(), 3);

    expect(capture.records[0]).not.toHaveProperty("error");
  });

  it("never throws, and reports a failing channel once", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    useConfig({ enabled: true, only: "all", channels: [new ThrowingChannel(), capture] });

    expect(() => {
      finishRequestLog(fakeRequest(), { statusCode: 200 }, undefined, Date.now(), 3);
      finishRequestLog(fakeRequest(), { statusCode: 200 }, undefined, Date.now(), 3);
    }).not.toThrow();

    expect(capture.records).toHaveLength(2);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toContain("disk full");
  });

  it("looks named channels up on the logger, and reports a missing one once", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    useConfig({ enabled: true, only: "all", channels: ["no-such-channel"] });

    finishRequestLog(fakeRequest(), { statusCode: 200 }, undefined, Date.now(), 3);
    finishRequestLog(fakeRequest(), { statusCode: 200 }, undefined, Date.now(), 3);

    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toContain("no-such-channel");
  });
});

describe("trackRequestLog", () => {
  it("writes the record after the socket closes, not before", async () => {
    useConfig({ enabled: true, only: "all", channels: [capture], include: { queries: false } });

    const raw = new EventEmitter();

    trackRequestLog(fakeRequest(), { raw, statusCode: 200 } as never);

    expect(capture.records).toEqual([]);

    raw.emit("close");

    expect(capture.records).toEqual([]);

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(capture.records).toHaveLength(1);
    expect(capture.records[0]).toMatchObject({ id: "r1", status: 200 });
  });
});

describe("when the request log is disabled", () => {
  it("is off by default outside development and starts nothing", async () => {
    const channelsBefore = log.channels.length;

    expect(isRequestLogEnabled()).toBe(false);

    await startRequestLog();

    expect(log.channels).toHaveLength(channelsBefore);
  });
});

describe("the log collector", () => {
  it("is passive and collects entries and errors of tracked requests only", () => {
    const collector = new RequestLogCollectorChannel(true);

    expect(collector.passive).toBe(true);

    beginRequestLogScope("r1");
    collector.log({ type: "info", module: "app", action: "a", message: "mine", context: { requestId: "r1" } });
    collector.log({ type: "info", module: "app", action: "a", message: "other", context: { requestId: "r2" } });
    collector.log({
      type: "error",
      module: "http",
      action: "request-error",
      message: new Error("db down"),
      context: { requestId: "r1" },
    });

    const scope = endRequestLogScope("r1");

    expect(scope?.logs.map((entry) => entry.message)).toEqual(["mine", "db down"]);
    expect(scope?.logged[0]).toMatchObject({ message: "db down" });
  });

  it("collects errors but no entries with include.logs off", () => {
    const collector = new RequestLogCollectorChannel(false);

    beginRequestLogScope("r1");
    collector.log({ type: "error", module: "a", action: "b", message: new Error("x"), context: { requestId: "r1" } });

    const scope = endRequestLogScope("r1");

    expect(scope?.logs).toEqual([]);
    expect(scope?.logged).toHaveLength(1);
  });

  it("is registered on the logger when the request log starts, and does not count as a destination", async () => {
    useConfig({ enabled: true, only: "all", channels: [capture], include: { queries: false } });

    await startRequestLog();

    const registered = log.channels.find((channel) => channel.name === "requestLogCollector");

    expect(registered?.passive).toBe(true);
  });
});
