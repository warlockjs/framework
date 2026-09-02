import config from "@mongez/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortInUseError } from "../../../src/http/port-preflight";

/**
 * The pre-boot probe is a REPORTING and ORDERING guarantee, not a networking
 * one — `port-preflight.test.ts` already proves `assertPortIsAvailable`
 * against a real held socket. What these specs pin down is everything that
 * failed the last time this bug was "fixed": that the probe reads the port
 * from config, that a collision is written to **stderr** (the logger has no
 * channels this early in the boot, so a `log.fatal` here would reach nobody),
 * and that the process is stopped rather than left to spend the next several
 * seconds connecting to a database it will throw away.
 *
 * `assertPortIsAvailable` is mocked so no port is ever bound here.
 */
const preflightMock = vi.hoisted(() => ({
  assertPortIsAvailable: vi.fn(async (_port: number, _host: string) => {}),
}));

vi.mock("../../../src/http/port-preflight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/http/port-preflight")>();

  return {
    ...actual,
    assertPortIsAvailable: preflightMock.assertPortIsAvailable,
  };
});

const { assertConfiguredHttpPortIsFree, preflightConfiguredHttpPort } = await import(
  "../../../src/http/boot-port-preflight"
);

describe("assertConfiguredHttpPortIsFree", () => {
  beforeEach(() => {
    preflightMock.assertPortIsAvailable.mockClear();
    preflightMock.assertPortIsAvailable.mockImplementation(async () => {});
  });

  afterEach(() => {
    config.set("http", undefined);
    vi.restoreAllMocks();
  });

  it("probes the configured port and host", async () => {
    config.set("http", { port: 3869, host: "0.0.0.0" });

    await assertConfiguredHttpPortIsFree();

    expect(preflightMock.assertPortIsAvailable).toHaveBeenCalledWith(3869, "0.0.0.0");
  });

  it("falls back to localhost when no host is configured — the host the connector binds", async () => {
    config.set("http", { port: 3869 });

    await assertConfiguredHttpPortIsFree();

    expect(preflightMock.assertPortIsAvailable).toHaveBeenCalledWith(3869, "localhost");
  });

  it("accepts a port that arrived from the environment as a string", async () => {
    config.set("http", { port: "3869" });

    await assertConfiguredHttpPortIsFree();

    expect(preflightMock.assertPortIsAvailable).toHaveBeenCalledWith(3869, "localhost");
  });

  it("does nothing for an app with no http config — it never binds", async () => {
    config.set("http", undefined);

    await assertConfiguredHttpPortIsFree();

    expect(preflightMock.assertPortIsAvailable).not.toHaveBeenCalled();
  });

  it("does nothing when the configured port is not a usable port number", async () => {
    config.set("http", { port: "not-a-port" });

    await assertConfiguredHttpPortIsFree();

    expect(preflightMock.assertPortIsAvailable).not.toHaveBeenCalled();
  });

  it("propagates PortInUseError", async () => {
    config.set("http", { port: 3869, host: "0.0.0.0" });

    const error = new PortInUseError(3869, "0.0.0.0");

    preflightMock.assertPortIsAvailable.mockImplementation(async () => {
      throw error;
    });

    await expect(assertConfiguredHttpPortIsFree()).rejects.toBe(error);
  });
});

describe("preflightConfiguredHttpPort", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    preflightMock.assertPortIsAvailable.mockClear();
    preflightMock.assertPortIsAvailable.mockImplementation(async () => {});

    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The function calls `process.exit(1)` and has nothing after it; stubbing
    // it to a no-op lets the body run out without killing the runner.
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    config.set("http", undefined);
    vi.restoreAllMocks();
  });

  it("names EADDRINUSE, the port and the host on stderr, then exits 1", async () => {
    config.set("http", { port: 3869, host: "0.0.0.0" });

    preflightMock.assertPortIsAvailable.mockImplementation(async () => {
      throw new PortInUseError(3869, "0.0.0.0");
    });

    await preflightConfiguredHttpPort();

    const output = errorSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");

    // Each of these was missing from the terminal in the reported failure:
    // the errno a developer greps for, the port, and the host.
    expect(output).toContain("EADDRINUSE");
    expect(output).toContain("3869");
    expect(output).toContain("0.0.0.0");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("hands over the command that names the owning process", async () => {
    config.set("http", { port: 3869, host: "0.0.0.0" });

    preflightMock.assertPortIsAvailable.mockImplementation(async () => {
      throw new PortInUseError(3869, "0.0.0.0");
    });

    await preflightConfiguredHttpPort();

    const output = errorSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    const expected =
      process.platform === "win32" ? "netstat -ano | findstr :3869" : "lsof -i :3869";

    expect(output).toContain(expected);
  });

  it("reports on stderr, never stdout — stdout carries only the ready banner", async () => {
    config.set("http", { port: 3869, host: "0.0.0.0" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    preflightMock.assertPortIsAvailable.mockImplementation(async () => {
      throw new PortInUseError(3869, "0.0.0.0");
    });

    await preflightConfiguredHttpPort();

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("stays silent and lets the boot continue when the port is free", async () => {
    config.set("http", { port: 3869, host: "0.0.0.0" });

    await preflightConfiguredHttpPort();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("never stops a boot over a probe that failed for some other reason", async () => {
    config.set("http", { port: 3869, host: "0.0.0.0" });

    // A convenience check must not become the thing that prevents an app from
    // booting; `HttpConnector` still runs the real preflight before `listen`.
    preflightMock.assertPortIsAvailable.mockImplementation(async () => {
      throw new Error("EADDRNOTAVAIL");
    });

    await expect(preflightConfiguredHttpPort()).resolves.toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();
  });
});
