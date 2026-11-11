import config from "@mongez/config";
import events from "@mongez/events";
import { LogChannel, log, type LoggingData } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logRequestLifecycle } from "../router/log-request-lifecycle";
import { Request } from "./request";
import { Response } from "./response";

class CaptureChannel extends LogChannel {
  public override name = "capture";
  public entries: LoggingData[] = [];

  public log(data: LoggingData): void {
    if (!this.shouldBeLogged(data)) return;

    this.entries.push(data);
  }
}

function makeRequest() {
  const request = new Request();
  const response = new Response();

  request.response = response;
  response.request = request;
  request.route = { method: "POST", path: "/orders" } as never;
  response.setRoute(request.route);

  return request;
}

describe("request logging builds nothing no channel keeps", () => {
  const previousChannels = log.channels;

  beforeEach(() => {
    config.set("http", { log: true });
  });

  afterEach(() => {
    log.setChannels(previousChannels);
    config.set("http", undefined);
    vi.restoreAllMocks();
  });

  it("skips the snapshot when every channel rejects the level", () => {
    const channel = new CaptureChannel({ levels: ["error"] });
    log.setChannels([channel]);

    const request = makeRequest();
    const snapshot = vi.spyOn(request, "toLogSnapshot");

    request.log("Executing the request");
    request.response.log("Sending response");

    expect(snapshot).not.toHaveBeenCalled();
    expect(channel.entries).toHaveLength(0);
  });

  it("still writes the phase lines a channel keeps", () => {
    const channel = new CaptureChannel();
    log.setChannels([channel]);

    const request = makeRequest();

    request.log("Executing the request");
    request.response.log("Sending response");

    expect(channel.entries.map((entry) => entry.message)).toEqual([
      "Executing the request",
      "Sending response",
    ]);
    expect(channel.entries[0]?.context?.request).toBe(channel.entries[1]?.context?.request);
  });

  it("builds one snapshot per request", () => {
    const request = makeRequest();

    expect(request.toLogSnapshot()).toBe(request.toLogSnapshot());
  });

  it("never builds the lifecycle context when the levels are not kept", async () => {
    const context = vi.fn(() => ({ request: {} }));
    const info = vi.fn();

    await logRequestLifecycle(
      {
        info,
        warn: vi.fn(),
        error: vi.fn(),
        now: () => 0,
        isEnabled: () => false,
      },
      { module: "route", action: "GET /", requestId: "r1", statusCode: () => 200, context },
      async () => "ok",
    );

    expect(context).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it("builds the lifecycle context once for both entries", async () => {
    const context = vi.fn(() => ({ request: { id: "r1" } }));
    const info = vi.fn();

    await logRequestLifecycle(
      { info, warn: vi.fn(), error: vi.fn(), now: () => 0, isEnabled: () => true },
      { module: "route", action: "GET /", requestId: "r1", statusCode: () => 200, context },
      async () => "ok",
    );

    expect(context).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls[0]?.[0].context).toBe(info.mock.calls[1]?.[0].context);
  });
});

describe("request.on", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    events.unsubscribe("request.executedAction");
  });

  it("keeps working and warns once that it subscribes process-wide", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => log);
    const calls: unknown[] = [];

    new Request().on("executedAction", (route: unknown) => calls.push(route));
    new Request().on("executedAction", () => undefined);

    new Request().trigger("executedAction", "route");

    expect(calls).toEqual(["route"]);
    const onWarnings = warn.mock.calls.filter(
      ([module, action]) => module === "request" && action === "on",
    );

    expect(onWarnings).toHaveLength(1);
  });
});
