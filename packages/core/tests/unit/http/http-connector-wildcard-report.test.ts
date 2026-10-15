import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpConnector } from "../../../src/connectors/http-connector";
import { getHttpReadyReport, resetHttpReadyReport } from "../../../src/http/ready-report";
import type { FastifyInstance } from "../../../src/http/server";
import { startHttpServer } from "../../../src/http/server";

/**
 * Pins the CONNECTOR's half of the wildcard fix.
 *
 * `describe-server-address.test.ts` proves the function reports a wildcard when
 * it is told the requested host, and `printed-url-is-reachable.test.ts` proves
 * it against a real bind. Neither notices if the connector simply stops passing
 * the host — and that argument is the entire fix, because Fastify's `listen()`
 * resolves a `0.0.0.0` bind back to `http://127.0.0.1:<port>` and the wildcard
 * exists nowhere in the value the connector gets back.
 *
 * Deleting that argument was silent across all three files. So this spec drives
 * the real `HttpConnector.start()` and reads the recorded report, which is what
 * the dev ready block renders its "(all interfaces)" note from.
 *
 * `listen` is stubbed to return exactly what Fastify returns for a `0.0.0.0`
 * bind — the point is what the connector does with that answer, and binding a
 * real wildcard socket in a unit test would open the machine's ports.
 */
class TestHttpConnector extends HttpConnector {
  public setHttp(server: FastifyInstance): void {
    (this as unknown as { http?: FastifyInstance }).http = server;
  }
}

async function reportForHost(host: string) {
  const port = 47_411;

  config.set("http", { port, host });

  vi.spyOn(log, "info").mockImplementation(async () => log);
  vi.spyOn(log, "success").mockImplementation(async () => log);
  vi.spyOn(log, "warn").mockImplementation(async () => log);

  const server = startHttpServer();

  // What Fastify actually hands back for `host: "0.0.0.0"` — the wildcard is
  // already gone by the time the connector sees it.
  vi.spyOn(server, "listen").mockImplementation(async () => `http://127.0.0.1:${port}`);

  const connector = new TestHttpConnector();
  connector.setHttp(server);

  await connector.start();

  return getHttpReadyReport();
}

describe("HttpConnector.start — the recorded report keeps a 0.0.0.0 bind visible", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetHttpReadyReport();
    config.unset("http");
  });

  it("records wildcardBind for a 0.0.0.0 host even though listen() reported loopback", async () => {
    const report = await reportForHost("0.0.0.0");

    expect(report?.boundAddress).toBe("http://127.0.0.1:47411");
    // The fact the ready block needs, recoverable only from what we asked for.
    expect(report?.wildcardBind).toBe(true);
    // ...and the displayed URL is still the localhost spelling, which reaches it.
    expect(report?.url).toBe("http://localhost:47411");
  });

  it("does not claim a wildcard for a loopback host", async () => {
    const report = await reportForHost("127.0.0.1");

    expect(report?.wildcardBind).toBe(false);
  });
});
