import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armRequestSummary, phaseLogLevel } from "./request-phase-log";
import { excludeFromRequestLog } from "./request-log/request-log-exclusions";

function fakeRequest(statusCode: number, path = "/poll?x=1") {
  const raw = new EventEmitter();
  const request = {
    id: "req-1",
    method: "GET",
    path,
    startTime: Date.now() - 5,
    response: { baseResponse: { raw, statusCode } },
  };

  return { request: request as never, raw };
}

describe("request phase log", () => {
  beforeEach(() => {
    config.set("http", { log: true });
  });

  afterEach(() => {
    config.set("http", undefined);
    vi.restoreAllMocks();
  });

  it("drops routine phase lines to debug and keeps warnings and errors", () => {
    expect(phaseLogLevel("info")).toBe("debug");
    expect(phaseLogLevel("success")).toBe("debug");
    expect(phaseLogLevel("warn")).toBe("warn");
    expect(phaseLogLevel("error")).toBe("error");
  });

  it('restores the verbose output with http.logPhases: "info"', () => {
    config.set("http", { log: true, logPhases: "info" });

    expect(phaseLogLevel("info")).toBe("info");
    expect(phaseLogLevel("success")).toBe("success");
  });

  it("writes one info summary line when the response closes", () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined as never);
    const { request, raw } = fakeRequest(200);

    armRequestSummary(request);
    expect(info).not.toHaveBeenCalled();

    raw.emit("close");

    expect(info).toHaveBeenCalledTimes(1);
    const [module, action, message, context] = info.mock.calls[0] as [string, string, string, any];
    expect(module).toBe("request");
    expect(action).toBe("completed");
    expect(message).toMatch(/^GET \/poll 200 \d+ms \[req-1\]$/);
    expect(context).toMatchObject({
      requestId: "req-1",
      method: "GET",
      path: "/poll",
      status: 200,
    });
  });

  it("writes no summary for a 5xx, which has its own error record", () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined as never);
    const { request, raw } = fakeRequest(500);

    armRequestSummary(request);
    raw.emit("close");

    expect(info).not.toHaveBeenCalled();
  });

  it("writes no summary for a path excluded from the request log", () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined as never);
    const restore = excludeFromRequestLog("/ops-7f3k2q9x");

    try {
      for (const path of ["/ops-7f3k2q9x", "/ops-7f3k2q9x/api/panels?x=1"]) {
        const { request, raw } = fakeRequest(404, path);

        armRequestSummary(request);
        raw.emit("close");
      }

      expect(info).not.toHaveBeenCalled();

      const { request, raw } = fakeRequest(200, "/ops-7f3k2q9xy");

      armRequestSummary(request);
      raw.emit("close");

      expect(info).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("writes nothing when http.log is off", () => {
    config.set("http", { log: false });
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined as never);
    const { request, raw } = fakeRequest(200);

    armRequestSummary(request);
    raw.emit("close");

    expect(info).not.toHaveBeenCalled();
  });
});
