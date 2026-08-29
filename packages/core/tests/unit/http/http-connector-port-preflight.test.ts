import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "../../../src/http/server";
import { startHttpServer } from "../../../src/http/server";
import { PortInUseError } from "../../../src/http/port-preflight";

/**
 * `assertPortIsAvailable` itself is covered by `port-preflight.test.ts`
 * against a real held socket. What is NOT covered there is that
 * `HttpConnector.start()` actually calls it — with the configured port and
 * host — before it binds, and that a `PortInUseError` takes the same fatal
 * exit path as any other listen failure without ever reaching `listen()`.
 * These specs isolate that wiring by mocking the preflight function only;
 * everything else `start()` touches (router, health, Fastify) is real.
 */
const preflightMock = vi.hoisted(() => ({
  assertPortIsAvailable: vi.fn(async () => {}),
}));

vi.mock("../../../src/http/port-preflight", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/http/port-preflight")>();

  return {
    ...actual,
    assertPortIsAvailable: preflightMock.assertPortIsAvailable,
  };
});

const { HttpConnector } = await import("../../../src/connectors/http-connector");

/**
 * Gives the test a hook to hand `start()` a Fastify instance without going
 * through `boot()` — `boot()` also registers plugins and health routes,
 * which are irrelevant to whether the preflight runs before `listen()`.
 */
class TestHttpConnector extends HttpConnector {
  public setHttp(server: FastifyInstance): void {
    (this as unknown as { http?: FastifyInstance }).http = server;
  }
}

describe("HttpConnector.start — port preflight ordering", () => {
  const port = 47_301;
  const host = "127.0.0.1";

  afterEach(() => {
    vi.restoreAllMocks();
    preflightMock.assertPortIsAvailable.mockClear();
    preflightMock.assertPortIsAvailable.mockImplementation(async () => {});
  });

  it("calls assertPortIsAvailable with the configured port and host before http.listen", async () => {
    config.set("http", { port, host });

    // The success path also calls `log.info`/`log.success`. Real channels are
    // free to do actual I/O (file, Sentry) which this spec has no interest in
    // waiting on — stub them out the same way the failure spec below stubs
    // `log.fatal`/`log.flush`.
    vi.spyOn(log, "info").mockImplementation(async () => log);
    vi.spyOn(log, "success").mockImplementation(async () => log);
    vi.spyOn(log, "warn").mockImplementation(async () => log);

    const server = startHttpServer();
    const callOrder: string[] = [];

    preflightMock.assertPortIsAvailable.mockImplementation(async () => {
      callOrder.push("preflight");
    });

    const listenSpy = vi
      .spyOn(server, "listen")
      .mockImplementation(async () => {
        callOrder.push("listen");
        return `http://${host}:${port}`;
      });

    const connector = new TestHttpConnector();
    connector.setHttp(server);

    await connector.start();

    expect(preflightMock.assertPortIsAvailable).toHaveBeenCalledWith(port, host);
    expect(listenSpy).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["preflight", "listen"]);
  });

  it("on PortInUseError logs fatal, flushes, and exits without ever calling listen", async () => {
    config.set("http", { port, host });

    const server = startHttpServer();
    const error = new PortInUseError(port, host);

    preflightMock.assertPortIsAvailable.mockImplementation(async () => {
      throw error;
    });

    const listenSpy = vi.spyOn(server, "listen");
    const fatalSpy = vi.spyOn(log, "fatal").mockImplementation(async () => log);
    const flushSpy = vi.spyOn(log, "flush").mockImplementation(async () => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      // `start()` calls `process.exit(1)` synchronously after `await
      // log.flush()`; stubbing it to a no-op lets the rest of the method body
      // run out (there is none after it) without killing the test process.
      .mockImplementation(() => undefined as never);

    const connector = new TestHttpConnector();
    connector.setHttp(server);

    await connector.start();

    expect(fatalSpy).toHaveBeenCalledWith("http", "connection", error);
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(listenSpy).not.toHaveBeenCalled();

    // fatal/flush/exit must have run in that order — flushing before the fatal
    // log has landed would drop it, and exiting before the flush would too.
    expect(fatalSpy.mock.invocationCallOrder[0]).toBeLessThan(
      flushSpy.mock.invocationCallOrder[0],
    );
    expect(flushSpy.mock.invocationCallOrder[0]).toBeLessThan(
      exitSpy.mock.invocationCallOrder[0],
    );
  });
});
