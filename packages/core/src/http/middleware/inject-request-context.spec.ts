import { DatabaseWriterValidationError } from "@warlock.js/cascade";
import config from "@mongez/config";
import { contextManager } from "@warlock.js/context";
import { log } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  HttpError,
  ResourceNotFoundError,
  ServerError,
} from "../errors";
import { tagRequestError } from "../report-request-error";
import type { Request } from "../request";
import type { Response } from "../response";

vi.mock("../csp", () => ({ applyCspHeader: vi.fn() }));
vi.mock("../csrf-default-guard", () => ({ runDefaultCsrfGuard: vi.fn(async () => undefined) }));

import { createRequestStore } from "./inject-request-context";

type LogCall = [message: unknown, level: string];

async function run(error: unknown) {
  const logs: LogCall[] = [];

  const request = {
    id: "req-1",
    route: {},
    log: vi.fn((message: unknown, level: string) => logs.push([message, level])),
    runMiddleware: vi.fn(async () => {
      throw error;
    }),
    trigger: vi.fn(),
  } as unknown as Request;

  const response = {
    header: vi.fn(),
    setStatusCode: vi.fn().mockReturnThis(),
    send: vi.fn((payload: unknown) => payload),
    serverError: vi.fn((payload: unknown) => payload),
  } as unknown as Response;

  await createRequestStore(request, response);

  return { logs, response };
}

const errorLevel = (logs: LogCall[]) => logs.filter(([, level]) => level === "error");
const warnLevel = (logs: LogCall[]) => logs.filter(([, level]) => level === "warn");

function onlyEntry(calls: LogCall[]): LogCall {
  const [entry] = calls;

  if (!entry || calls.length !== 1) {
    throw new Error(`expected exactly one log entry, got ${calls.length}`);
  }

  return entry;
}

let loggerError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  loggerError = vi.spyOn(log, "error").mockResolvedValue(undefined as never);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  // Run the callback directly: the request contexts are not under test here.
  vi.spyOn(contextManager, "buildStores").mockReturnValue({} as never);
  vi.spyOn(contextManager, "runAll").mockImplementation(((
    _store: unknown,
    callback: () => unknown,
  ) => callback()) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRequestStore error logging", () => {
  it("logs a thrown 409 once at warn level with no stack and no error entry", async () => {
    const { logs, response } = await run(new ConflictError("Email taken"));

    expect(errorLevel(logs)).toHaveLength(0);
    expect(warnLevel(logs)).toHaveLength(1);

    const [message] = onlyEntry(warnLevel(logs));

    expect(typeof message).toBe("string");
    expect(message).toBe("ConflictError: Email taken (409)");
    expect(String(message)).not.toContain("\n");
    expect(String(message)).not.toContain(" at ");
    expect(loggerError).not.toHaveBeenCalled();
    expect(response.setStatusCode).toHaveBeenCalledWith(409);
  });

  it("logs a thrown 404 at warn level, not error", async () => {
    const { logs } = await run(new ResourceNotFoundError("No such post"));

    expect(errorLevel(logs)).toHaveLength(0);
    expect(warnLevel(logs)).toEqual([["ResourceNotFoundError: No such post (404)", "warn"]]);
    expect(loggerError).not.toHaveBeenCalled();
  });

  it("treats a raw HttpError with a 4xx status as a client error", async () => {
    const { logs } = await run(new HttpError(418, "teapot"));

    expect(errorLevel(logs)).toHaveLength(0);
    expect(warnLevel(logs)).toEqual([["HttpError: teapot (418)", "warn"]]);
  });

  it("logs a model validation error configured as 422 at warn level without the error-level entry", async () => {
    vi.spyOn(config, "get").mockImplementation(((key: string, fallback?: unknown) =>
      key === "http.modelValidationErrorStatus" ? 422 : fallback) as typeof config.get);

    const { logs, response } = await run(
      new DatabaseWriterValidationError("Validation failed", [
        { path: "email", error: "required", rule: "required" },
      ] as never),
    );

    expect(errorLevel(logs)).toHaveLength(0);
    expect(warnLevel(logs)).toHaveLength(1);
    expect(String(onlyEntry(warnLevel(logs))[0])).toMatch(/\(422\)$/);
    expect(loggerError).not.toHaveBeenCalled();
    expect(response.setStatusCode).toHaveBeenCalledWith(422);
  });

  it("keeps the error-level entry with the stack for a thrown 500", async () => {
    const error = new ServerError("boom");
    const { logs } = await run(error);

    expect(warnLevel(logs)).toHaveLength(0);
    expect(errorLevel(logs)).toEqual([[error, "error"]]);
    expect((onlyEntry(errorLevel(logs))[0] as Error).stack).toBeTruthy();
    // the existing 5xx logger entry in handleRequestError is unchanged
    expect(loggerError).toHaveBeenCalledTimes(1);
  });

  it("keeps the error-level entry with the stack for a plain Error", async () => {
    const error = new Error("unexpected");
    const { logs } = await run(error);

    expect(warnLevel(logs)).toHaveLength(0);
    expect(errorLevel(logs)).toEqual([[error, "error"]]);
    expect((onlyEntry(errorLevel(logs))[0] as Error).stack).toBeTruthy();
  });
});

describe("http.errorMapper", () => {
  class DomainNotFound extends Error {
    public constructor(message: string) {
      super(message);
      this.name = "DomainNotFound";
    }
  }

  function withMapper(mapper: unknown) {
    vi.spyOn(config, "get").mockImplementation(((key: string, fallback?: unknown) =>
      key === "http.errorMapper" ? mapper : fallback) as typeof config.get);
  }

  it("answers a mapped domain error with the mapped status and its own message", async () => {
    withMapper((error: unknown) => (error instanceof DomainNotFound ? { status: 404 } : undefined));

    const { logs, response } = await run(new DomainNotFound("No such workspace"));

    expect(response.setStatusCode).toHaveBeenCalledWith(404);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: "No such workspace" }),
    );
    expect(warnLevel(logs)).toEqual([["DomainNotFound: No such workspace (404)", "warn"]]);
    expect(errorLevel(logs)).toHaveLength(0);
  });

  it("sends the mapped message and payload when given", async () => {
    withMapper(() => ({ status: 409, message: "Revision changed", payload: { revision: 3 } }));

    const { response } = await run(new Error("cas failed"));

    expect(response.setStatusCode).toHaveBeenCalledWith(409);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Revision changed", payload: { revision: 3 } }),
    );
  });

  it("keeps a mapped 5xx opaque unless the mapper sets a message", async () => {
    withMapper(() => ({ status: 503 }));

    const { response } = await run(new Error("db pool host=10.0.0.4 exhausted"));

    expect(response.setStatusCode).toHaveBeenCalledWith(503);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Internal server error." }),
    );
  });

  it("accepts an HttpError returned by the mapper", async () => {
    withMapper(() => new ConflictError("taken"));

    const { response } = await run(new Error("raw"));

    expect(response.setStatusCode).toHaveBeenCalledWith(409);
  });

  it("supports a duck-typed status contract written in the mapper", async () => {
    withMapper((error: any) =>
      typeof error?.status === "number" ? { status: error.status } : undefined,
    );

    const error = Object.assign(new Error("gone"), { status: 410 });
    const { response } = await run(error);

    expect(response.setStatusCode).toHaveBeenCalledWith(410);
  });

  it("falls back to the opaque 500 when the mapper declines", async () => {
    withMapper(() => undefined);

    const { response } = await run(new Error("unexpected"));

    expect(response.serverError).toHaveBeenCalledWith({ error: "Internal server error." });
  });

  it("is not consulted for an HttpError", async () => {
    const mapper = vi.fn(() => ({ status: 500 }));
    withMapper(mapper);

    const { response } = await run(new ResourceNotFoundError("nope"));

    expect(mapper).not.toHaveBeenCalled();
    expect(response.setStatusCode).toHaveBeenCalledWith(404);
  });

  it("logs a throwing mapper and handles the original error", async () => {
    withMapper(() => {
      throw new Error("mapper bug");
    });

    const { response } = await run(new Error("unexpected"));

    expect(loggerError).toHaveBeenCalledWith("http", "error-mapper", expect.any(Error), {
      requestId: "req-1",
    });
    expect(response.serverError).toHaveBeenCalled();
  });

  it("ignores a mapping with a non-error status", async () => {
    withMapper(() => ({ status: 200 }));

    const { response } = await run(new Error("unexpected"));

    expect(response.serverError).toHaveBeenCalled();
  });
});

describe("createRequestStore 5xx record", () => {
  function createRequest(overrides: Record<string, unknown> = {}, handler?: unknown) {
    function showPost() {
      return undefined;
    }

    const route = {
      name: "posts.show",
      path: "/posts/:id",
      sourceFile: "src/app/posts/routes.ts",
      handler: handler ?? showPost,
    };

    return {
      id: "req-7",
      method: "GET",
      path: "/posts/1?debug=1",
      route,
      log: vi.fn(),
      runMiddleware: vi.fn(async () => undefined),
      getHandler: () => route.handler,
      trigger: vi.fn(),
      ...overrides,
    } as unknown as Request;
  }

  function createResponse(statusCode = 200) {
    return {
      statusCode,
      header: vi.fn(),
      setStatusCode: vi.fn().mockReturnThis(),
      send: vi.fn((payload: unknown) => payload),
      serverError: vi.fn((payload: unknown) => payload),
    } as unknown as Response;
  }

  const records = () =>
    loggerError.mock.calls
      .map(([entry]: [unknown]) => entry)
      .filter((entry: unknown) => typeof entry === "object" && entry !== null) as Array<{
      action: string;
      context: Record<string, unknown>;
    }>;

  it("leaves one record with the route and the handler for a controller throw", async () => {
    const request = createRequest(
      {},
      async function showPost() {
        throw new Error("controller exploded");
      },
    );

    await createRequestStore(request, createResponse());

    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({
      action: "request.handler",
      context: {
        phase: "handler",
        method: "GET",
        pathname: "/posts/1",
        routeName: "posts.show",
        routePath: "/posts/:id",
        handler: "showPost",
        requestId: "req-7",
        statusCode: 500,
      },
    });
  });

  it("names the middleware that threw", async () => {
    const request = createRequest({
      runMiddleware: vi.fn(async () => {
        const failure = new Error("token store down");

        tagRequestError(failure, { phase: "middleware", middleware: "authMiddleware" });

        throw failure;
      }),
    });

    await createRequestStore(request, createResponse());

    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({
      action: "request.middleware",
      context: { phase: "middleware", middleware: "authMiddleware" },
    });
  });

  it("does not log a thrown 4xx as an error record", async () => {
    const request = createRequest({
      runMiddleware: vi.fn(async () => {
        throw new ForbiddenError("Forbidden");
      }),
    });

    await createRequestStore(request, createResponse());

    expect(records()).toHaveLength(0);
  });

  it("logs a 5xx the handler returned without throwing", async () => {
    const request = createRequest({}, async () => undefined);

    await createRequestStore(request, createResponse(502));

    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({
      action: "request.handler",
      context: { phase: "handler", statusCode: 502 },
    });
  });

  it("does not log a returned 503 (maintenance, readiness)", async () => {
    const request = createRequest({}, async () => undefined);

    await createRequestStore(request, createResponse(503));

    expect(records()).toHaveLength(0);
  });

  it("adds the request id to the JSON error body in development only", async () => {
    const original = process.env.NODE_ENV;
    const failing = () => ({
      runMiddleware: vi.fn(async () => {
        throw new ServerError("boom");
      }),
    });

    try {
      process.env.NODE_ENV = "development";

      const development = createResponse();
      await createRequestStore(createRequest(failing()), development);

      expect(development.setStatusCode).toHaveBeenCalledWith(500);
      expect(development.send).toHaveBeenCalledWith(
        expect.objectContaining({ error: "boom", requestId: "req-7" }),
      );

      process.env.NODE_ENV = "production";

      const production = createResponse();
      await createRequestStore(createRequest(failing()), production);

      expect(production.send).toHaveBeenCalledWith({ error: "boom" });
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
