import type { MultipartFile } from "@fastify/multipart";
import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import { UploadedFile } from "../uploaded-file";
import {
  buildRequestLogRecord,
  limitRequestLogBody,
  sanitizeRequestLogValue,
  type RequestLogInput,
} from "./build-request-log-record";
import { resolveRequestLogConfig } from "./resolve-request-log-config";

afterEach(() => {
  config.set("http.logging", undefined);
});

const development = resolveRequestLogConfig({ enabled: true }, "development");
const production = resolveRequestLogConfig({ enabled: true }, "production");

function input(overrides: Partial<RequestLogInput> = {}): RequestLogInput {
  return {
    id: "req-1",
    traceId: "trace-1",
    startedAt: Date.UTC(2026, 9, 24, 12, 0, 0),
    method: "POST",
    url: "/users/7?page=2",
    ip: "10.0.0.1",
    route: { path: "/users/:id", name: "users.update" },
    params: { id: "7" },
    query: { page: "2" },
    headers: { accept: "application/json", "user-agent": "vitest" },
    body: { name: "Ada" },
    session: { userId: 7, userType: "admin" },
    status: 200,
    durationMs: 12.3456,
    response: { size: 42, headers: { "content-type": "application/json" }, body: { ok: true } },
    ...overrides,
  };
}

describe("buildRequestLogRecord", () => {
  it("builds the full record in development", () => {
    const record = buildRequestLogRecord(input(), development);

    expect(record).toMatchObject({
      type: "request",
      id: "req-1",
      traceId: "trace-1",
      time: "2026-10-24T12:00:00.000Z",
      method: "POST",
      url: "/users/7?page=2",
      route: { name: "users.update", pattern: "/users/:id" },
      params: { id: "7" },
      query: { page: "2" },
      body: { name: "Ada" },
      session: { userId: 7, userType: "admin" },
      ip: "10.0.0.1",
      status: 200,
      durationMs: 12.35,
      response: { size: 42, body: { ok: true }, headers: { "content-type": "application/json" } },
    });
  });

  it("redacts secrets in headers, body, query and URL", () => {
    const record = buildRequestLogRecord(
      input({
        url: "/hooks?secret=abc&page=2",
        query: { secret: "abc", page: "2" },
        headers: { authorization: "Bearer t0k", cookie: "sid=1", "x-custom": "ok" },
        body: { email: "a@b.c", password: "hunter2", profile: { apiKey: "k" } },
        response: { body: { accessToken: "jwt" } },
      }),
      development,
    );

    expect(record.url).toBe("/hooks?secret=[REDACTED]&page=2");
    expect(record.query).toEqual({ secret: "[REDACTED]", page: "2" });
    expect(record.headers).toEqual({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      "x-custom": "ok",
    });
    expect(record.body).toEqual({
      email: "a@b.c",
      password: "[REDACTED]",
      profile: { apiKey: "[REDACTED]" },
    });
    expect(record.response.body).toEqual({ accessToken: "[REDACTED]" });
    expect(JSON.stringify(record)).not.toContain("hunter2");
  });

  it("keeps only allowlisted headers outside development", () => {
    const record = buildRequestLogRecord(
      input({
        headers: {
          Accept: "application/json",
          Cookie: "sid=1",
          Authorization: "Bearer t",
          "x-tenant-secret": "s",
          "user-agent": "vitest",
        },
      }),
      production,
    );

    expect(record.headers).toEqual({ accept: "application/json", "user-agent": "vitest" });
  });

  it("leaves bodies and response headers out in production unless asked", () => {
    const record = buildRequestLogRecord(input(), production);

    expect(record.body).toBeUndefined();
    expect(record.response).toEqual({ size: 42 });

    const withBodies = buildRequestLogRecord(
      input(),
      resolveRequestLogConfig({ enabled: true, include: { body: true, response: true } }, "production"),
    );

    expect(withBodies.body).toEqual({ name: "Ada" });
    expect(withBodies.response.body).toEqual({ ok: true });
  });

  it("applies the route's logging option", () => {
    const record = buildRequestLogRecord(
      input({
        url: "/login?next=%2F",
        route: { path: "/login", logging: { body: false, query: false } },
        response: { body: { accessToken: "x" } },
      }),
      development,
    );

    expect(record.body).toBeUndefined();
    expect(record.query).toBeUndefined();
    expect(record.url).toBe("/login");
    expect(record.response.body).toBeUndefined();
  });

  it("applies http.logging private URL rules even to unmatched route options", () => {
    config.set("http.logging", { private: [{ path: "/vault", body: false, query: false }] });

    const record = buildRequestLogRecord(
      input({
        url: "/vault/keys?name=a",
        route: { path: "/vault/:name", logging: { body: true, query: true } },
        body: { value: "sentinel" },
        query: { name: "a" },
        response: { body: { value: "sentinel" } },
      }),
      development,
    );

    expect(record.body).toBeUndefined();
    expect(record.query).toBeUndefined();
    expect(record.url).toBe("/vault/keys");
    expect(record.response.body).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain("sentinel");
  });

  it("honours include flags", () => {
    const record = buildRequestLogRecord(
      input(),
      resolveRequestLogConfig(
        {
          include: {
            headers: false,
            body: false,
            query: false,
            params: false,
            session: false,
            response: false,
          },
        },
        "development",
      ),
    );

    expect(record).not.toHaveProperty("headers");
    expect(record).not.toHaveProperty("body");
    expect(record).not.toHaveProperty("query");
    expect(record).not.toHaveProperty("params");
    expect(record).not.toHaveProperty("session");
    expect(record.response).toEqual({ size: 42 });
  });

  it("records uploaded files as metadata only", () => {
    const file = new UploadedFile({
      filename: "avatar.png",
      mimetype: "image/png",
      file: { secret: "bytes" },
    } as unknown as MultipartFile);

    const record = buildRequestLogRecord(
      input({ body: { avatar: file, gallery: [file], nested: { doc: file } } }),
      development,
    );

    const metadata = { file: "avatar.png", mimeType: "image/png" };

    expect(record.body).toEqual({ avatar: metadata, gallery: [metadata], nested: { doc: metadata } });
  });

  it("truncates a large body with a marker", () => {
    const record = buildRequestLogRecord(
      input({ body: { text: "x".repeat(500) } }),
      resolveRequestLogConfig({ maxBodyBytes: 100 }, "development"),
    );

    expect(typeof record.body).toBe("string");
    expect(record.body as string).toMatch(/…\[truncated, \d+ bytes\]$/);
    expect((record.body as string).length).toBeLessThan(200);
  });

  it("attaches the error, and drops its stack with include.stack false", () => {
    const error = {
      message: "boom",
      name: "TypeError",
      stack: "TypeError: boom\n    at a.ts:1:1",
      phase: "render",
      file: "src/app/home.page.tsx",
      site: "main",
    };

    expect(buildRequestLogRecord(input({ status: 500, error }), development).error).toEqual(error);

    const withoutStack = buildRequestLogRecord(
      input({ status: 500, error }),
      resolveRequestLogConfig({ include: { stack: false } }, "development"),
    );

    expect(withoutStack.error).toEqual({
      message: "boom",
      name: "TypeError",
      phase: "render",
      file: "src/app/home.page.tsx",
      site: "main",
    });
  });

  it("passes phases, logs and queries through and honours their include flags", () => {
    const extra = {
      phases: [{ name: "handler", durationMs: 4 }],
      logs: [{ level: "info", module: "app", action: "x", message: "hi", at: 1 }],
      queries: { count: 3, slowest: { durationMs: 9, query: "select ?" } },
    };

    expect(buildRequestLogRecord(input(extra), development)).toMatchObject(extra);

    const record = buildRequestLogRecord(
      input(extra),
      resolveRequestLogConfig({ include: { phases: false, logs: false, queries: false } }, "development"),
    );

    expect(record).not.toHaveProperty("phases");
    expect(record).not.toHaveProperty("logs");
    expect(record).not.toHaveProperty("queries");
  });
});

describe("sanitizeRequestLogValue", () => {
  it("makes values JSON safe", () => {
    expect(
      sanitizeRequestLogValue({
        date: new Date("2026-01-01T00:00:00.000Z"),
        buffer: Buffer.from("abc"),
        big: 10n,
        fn: () => 1,
        stream: { pipe() {} },
      }),
    ).toEqual({
      date: "2026-01-01T00:00:00.000Z",
      buffer: "[Buffer 3 bytes]",
      big: "10",
      stream: "[Stream]",
    });
  });
});

describe("limitRequestLogBody", () => {
  it("returns small bodies untouched", () => {
    const body = { a: 1 };

    expect(limitRequestLogBody(body, 100)).toBe(body);
  });
});
