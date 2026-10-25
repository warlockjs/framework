import { log } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, ServerError } from "./errors";
import {
  readRequestErrorOrigin,
  reportRequestServerError,
  tagRequestError,
} from "./report-request-error";
import type { Request } from "./request";

function createRequest(overrides: Record<string, unknown> = {}): Request {
  function createPost() {
    return undefined;
  }

  return {
    id: "req-42",
    method: "POST",
    path: "/posts?token=secret",
    route: {
      name: "posts.create",
      path: "/posts",
      sourceFile: "src/app/posts/routes.ts",
      handler: createPost,
    },
    ...overrides,
  } as unknown as Request;
}

let logError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logError = vi.spyOn(log, "error").mockResolvedValue(undefined as never);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function onlyRecord() {
  expect(logError).toHaveBeenCalledTimes(1);

  return logError.mock.calls[0]![0] as {
    module: string;
    action: string;
    message: string;
    context: Record<string, unknown>;
  };
}

describe("reportRequestServerError", () => {
  it("writes one error record with the route, handler, phase and request id", () => {
    const error = new ServerError("database is down");

    reportRequestServerError({ error, request: createRequest(), status: 500, phase: "handler" });

    const record = onlyRecord();

    expect(record.module).toBe("http");
    expect(record.action).toBe("request.handler");
    expect(record.message).toBe("Request failed: database is down");
    expect(record.context).toMatchObject({
      name: "ServerError",
      message: "database is down",
      phase: "handler",
      method: "POST",
      pathname: "/posts",
      routeName: "posts.create",
      routePath: "/posts",
      file: "src/app/posts/routes.ts",
      handler: "createPost",
      requestId: "req-42",
      statusCode: 500,
    });
    expect(record.context.stack).toBe(error.stack);
  });

  it("never carries the query string", () => {
    reportRequestServerError({
      error: new Error("boom"),
      request: createRequest(),
      status: 500,
      phase: "handler",
    });

    expect(JSON.stringify(onlyRecord().context)).not.toContain("secret");
  });

  it("names the middleware and phase a throw site tagged", () => {
    const error = new Error("session store unreachable");

    tagRequestError(error, { phase: "middleware", middleware: "authMiddleware" });

    reportRequestServerError({ error, request: createRequest(), status: 500, phase: "handler" });

    const record = onlyRecord();

    expect(record.action).toBe("request.middleware");
    expect(record.context).toMatchObject({ phase: "middleware", middleware: "authMiddleware" });
  });

  it("keeps the innermost tag when an error is tagged twice", () => {
    const error = new Error("boom");

    tagRequestError(error, { phase: "validation" });
    tagRequestError(error, { phase: "middleware", middleware: "outer" });

    expect(readRequestErrorOrigin(error)).toEqual({ phase: "validation" });
  });

  it("reads the tag off the original throw when the mapped error is a different object", () => {
    const thrown = new Error("driver error");
    const mapped = new ServerError("opaque");

    tagRequestError(thrown, { phase: "middleware", middleware: "rateLimit" });

    reportRequestServerError({
      error: mapped,
      thrown,
      request: createRequest(),
      status: 500,
      phase: "handler",
    });

    expect(onlyRecord().context).toMatchObject({ phase: "middleware", middleware: "rateLimit" });
  });

  it("writes at most one record per request", () => {
    const request = createRequest();

    reportRequestServerError({ error: new Error("first"), request, status: 500, phase: "handler" });
    reportRequestServerError({
      error: new Error("second"),
      request,
      status: 502,
      phase: "response",
    });

    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("does not report a 4xx as an error", () => {
    reportRequestServerError({
      error: new ForbiddenError("nope"),
      request: createRequest(),
      status: 403,
      phase: "middleware",
    });

    expect(logError).not.toHaveBeenCalled();
  });

  it("describes a returned 5xx that nothing threw", () => {
    reportRequestServerError({
      error: undefined,
      request: createRequest(),
      status: 500,
      phase: "response",
    });

    expect(onlyRecord().context).toMatchObject({
      message: "The response status is 500 but nothing threw.",
      phase: "response",
      statusCode: 500,
    });
  });

  it("falls back to console.error when no log channel is configured", () => {
    const error = new Error("boom");

    reportRequestServerError({ error, request: createRequest(), status: 500, phase: "handler" });

    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("never throws when the request is missing route details", () => {
    expect(() =>
      reportRequestServerError({
        error: new Error("boom"),
        request: { id: "req-1", route: {} } as unknown as Request,
        status: 500,
        phase: "handler",
      }),
    ).not.toThrow();
    expect(onlyRecord().context).toMatchObject({ requestId: "req-1", phase: "handler" });
  });
});
