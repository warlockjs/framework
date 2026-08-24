import { describe, expect, it } from "vitest";
import type {
  RequestLogDescriptor,
  RequestLogEntry,
  RequestLogPorts,
} from "../../../src/router/log-request-lifecycle";
import { logRequestLifecycle } from "../../../src/router/log-request-lifecycle";

/*
  The defect this file closes: `router.ts` logged "Starting Request: <id>" and
  nothing else. A request that hung for thirty seconds and one that returned in
  two milliseconds produced byte-identical output, so the log could not answer
  the one question anyone opens it to ask.

  Note what "detecting a hang" actually means here. Nothing can log the
  completion of a request that never completes — the mechanism is the ABSENCE
  of a completion line beside a start line that has one. That only works if the
  completion line is emitted on EVERY settled path, including a throw, which is
  why the error case below is not an afterthought.
*/

type Captured = RequestLogEntry & { level: "info" | "warn" | "error" };

function harness(clock: number[] = [0, 25]) {
  const entries: Captured[] = [];
  let tick = 0;

  const ports: RequestLogPorts = {
    info: entry => entries.push({ ...entry, level: "info" }),
    warn: entry => entries.push({ ...entry, level: "warn" }),
    error: entry => entries.push({ ...entry, level: "error" }),
    now: () => clock[Math.min(tick++, clock.length - 1)] as number,
  };

  return { ports, entries };
}

function descriptor(overrides: Partial<RequestLogDescriptor> = {}): RequestLogDescriptor {
  return {
    module: "route",
    action: "GET /products",
    requestId: "abc123",
    statusCode: () => 200,
    ...overrides,
  };
}

describe("logRequestLifecycle — the completion line", () => {
  it("emits a start line and a completion line", async () => {
    const { ports, entries } = harness();

    await logRequestLifecycle(ports, descriptor(), async () => "ok");

    expect(entries).toHaveLength(2);
    expect(entries[0]?.message).toContain("Starting Request: abc123");
  });

  it("carries the same request id, so the two lines correlate", async () => {
    const { ports, entries } = harness();

    await logRequestLifecycle(ports, descriptor(), async () => "ok");

    expect(entries[1]?.message).toContain("abc123");
  });

  it("carries the status code and the duration", async () => {
    const { ports, entries } = harness([0, 25]);

    await logRequestLifecycle(ports, descriptor({ statusCode: () => 201 }), async () => "ok");

    expect(entries[1]?.message).toContain("201");
    expect(entries[1]?.message).toContain("25");
  });

  it("returns the run's own result untouched", async () => {
    const { ports } = harness();

    await expect(logRequestLifecycle(ports, descriptor(), async () => ({ a: 1 }))).resolves.toEqual({
      a: 1,
    });
  });

  it("reads the status AFTER the run, not before", async () => {
    const { ports, entries } = harness();
    let status = 200;

    await logRequestLifecycle(ports, descriptor({ statusCode: () => status }), async () => {
      status = 404;
      return "ok";
    });

    expect(entries[1]?.message).toContain("404");
  });
});

describe("logRequestLifecycle — a request that throws", () => {
  it("still emits a completion line", async () => {
    const { ports, entries } = harness();

    await expect(
      logRequestLifecycle(ports, descriptor(), async () => {
        throw new Error("handler blew up");
      }),
    ).rejects.toThrow("handler blew up");

    expect(entries).toHaveLength(2);
  });

  it("does not swallow the error", async () => {
    const { ports } = harness();
    const boom = new Error("handler blew up");

    await expect(
      logRequestLifecycle(ports, descriptor(), async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it("logs the failure at error level", async () => {
    const { ports, entries } = harness();

    await logRequestLifecycle(ports, descriptor(), async () => {
      throw new Error("x");
    }).catch(() => undefined);

    expect(entries[1]?.level).toBe("error");
  });
});

describe("logRequestLifecycle — the level reflects the outcome", () => {
  /*
    A handled 500 does not throw — it returns a response. Logging it at `info`
    would hide the exact entries someone scanning the log is looking for.
  */
  it.each([
    [200, "info"],
    [204, "info"],
    [301, "info"],
    [404, "warn"],
    [422, "warn"],
    [500, "error"],
    [503, "error"],
  ])("logs status %i at %s level", async (status, level) => {
    const { ports, entries } = harness();

    await logRequestLifecycle(ports, descriptor({ statusCode: () => status }), async () => "ok");

    expect(entries[1]?.level).toBe(level);
  });

  it("falls back to info when the status is unknown", async () => {
    const { ports, entries } = harness();

    await logRequestLifecycle(ports, descriptor({ statusCode: () => undefined }), async () => "ok");

    expect(entries[1]?.level).toBe("info");
  });
});
