import config from "@mongez/config";
import { log, LogChannel, safeJsonStringify, type LoggingData } from "@warlock.js/logger";
import { v } from "@warlock.js/seal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";
import { Response } from "../../../src/http/response";
import type { Middleware, RequestHandler } from "../../../src/router/types";
import { bootHarness, type HttpHarness } from "./harness";

/**
 * request log entries carry a bounded snapshot with the route's
 * logging policy applied BEFORE logging, so values a route rejects (schema or
 * middleware) and credential-bearing URLs never reach a log channel.
 *
 * A capturing channel records what every sink would receive (after the
 * logger's own key redaction). Synthetic sentinels only.
 */

class CaptureChannel extends LogChannel {
  public name = "capture";
  public entries: LoggingData[] = [];

  public log(data: LoggingData) {
    this.entries.push(data);
  }

  public get serialized() {
    return this.entries.map((entry) => safeJsonStringify(entry)).join("\n");
  }
}

let harness: HttpHarness;
let capture: CaptureChannel;

beforeEach(() => {
  capture = new CaptureChannel();
  log.addChannel(capture);
  config.set("http.log", true);
});

afterEach(async () => {
  log.channels = log.channels.filter((channel) => channel !== capture);
  config.set("http.log", undefined);
  await harness?.close();
});

function validatedHandler(): RequestHandler {
  const handler: RequestHandler = ({ response }) => response.success({ ok: true });

  handler.validation = { schema: v.object({ name: v.string().required() }) };

  return handler;
}

describe("request log privacy", () => {
  it("never puts Request/Response instances in log context", async () => {
    harness = await bootHarness((router) => {
      router.get("/plain", ({ response }) => response.success({ ok: true }));
    });

    await harness.inject({ method: "GET", url: "/plain" });

    expect(capture.entries.length).toBeGreaterThan(0);

    for (const entry of capture.entries) {
      for (const value of Object.values(entry.context ?? {})) {
        expect(value).not.toBeInstanceOf(Request);
        expect(value).not.toBeInstanceOf(Response);
      }
    }
  });

  it("logs the rejected body of an ordinary route (control)", async () => {
    harness = await bootHarness((router) => {
      router.post("/ordinary", validatedHandler());
    });

    const result = await harness.inject({
      method: "POST",
      url: "/ordinary",
      payload: { providerId: "control-sentinel" },
    });

    expect(result.statusCode).toBe(422);
    expect(capture.serialized).toContain("control-sentinel");
  });

  it("omits a schema-rejected body, nested fields included, on a sensitive route", async () => {
    harness = await bootHarness((router) => {
      router.post("/sensitive", validatedHandler(), { logging: { body: false } });
    });

    const result = await harness.inject({
      method: "POST",
      url: "/sensitive",
      payload: { providerId: "schema-sentinel", nested: { endpoint: "nested-sentinel" } },
    });

    expect(result.statusCode).toBe(422);
    expect(capture.entries.length).toBeGreaterThan(0);
    expect(capture.serialized).not.toContain("schema-sentinel");
    expect(capture.serialized).not.toContain("nested-sentinel");
  });

  it("omits body and query when a middleware rejects the request", async () => {
    const reject: Middleware = ({ response }) => response.badRequest({ error: "nope" });

    harness = await bootHarness((router) => {
      router.post("/guarded", ({ response }) => response.success(), {
        middleware: [reject],
        logging: { body: false, query: false },
      });
    });

    const result = await harness.inject({
      method: "POST",
      url: "/guarded?note=query-sentinel",
      payload: { actorId: "middleware-sentinel" },
    });

    expect(result.statusCode).toBe(400);
    expect(capture.serialized).not.toContain("query-sentinel");
    expect(capture.serialized).not.toContain("middleware-sentinel");
  });

  it("masks a credential query parameter in the logged URL", async () => {
    harness = await bootHarness((router) => {
      router.get("/hooks", ({ response }) => response.success({ ok: true }));
    });

    await harness.inject({ method: "GET", url: "/hooks?secret=url-sentinel&page=2" });

    expect(capture.serialized).not.toContain("url-sentinel");
    expect(capture.serialized).toContain("/hooks?secret=[REDACTED]&page=2");
  });
});
