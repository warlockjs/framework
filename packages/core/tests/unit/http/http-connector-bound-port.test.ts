import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Application } from "../../../src/application";
import { HttpConnector } from "../../../src/connectors/http-connector";
import { getHttpReadyReport, resetHttpReadyReport } from "../../../src/http/ready-report";
import type { FastifyInstance } from "../../../src/http/server";
import { startHttpServer } from "../../../src/http/server";
import { getTestServerUrl } from "../../../src/tests/test-helpers";
import { TEST_SERVER_PORT_ENV_KEY } from "../../../src/tests/test-server-port-channel";

/**
 * Card b7ae66b4 — the framework used to publish the CONFIGURED port
 * (`http.port`), not the port Fastify actually bound. That already shipped one
 * incident: "Server ready at" naming a URL that gave connection refused
 * (`describe-server-address.ts`'s module doc). A prior fix (`aef9006`) made
 * the configured value canonical — no more raw strings reaching `listen()` —
 * but never stopped publishing THAT value instead of the real bind. This spec
 * pins the actual fix: `HttpConnector.start()` now reads the bound port back
 * out of what `listen()` resolved and publishes THAT, so `port: 0` — the case
 * where "configured" and "bound" can never be the same number — is reported
 * truthfully instead of surfacing as `0`.
 *
 * Same harness as `http-connector-port-preflight.test.ts` /
 * `http-connector-wildcard-report.test.ts`: a subclass exposes the private
 * `http` field so `start()` can run against a fastify instance without going
 * through the full `boot()` sequence.
 */
class TestHttpConnector extends HttpConnector {
  public setHttp(server: FastifyInstance): void {
    (this as unknown as { http?: FastifyInstance }).http = server;
  }
}

function silenceHttpLogs() {
  vi.spyOn(log, "info").mockImplementation(async () => log);
  vi.spyOn(log, "success").mockImplementation(async () => log);
  vi.spyOn(log, "warn").mockImplementation(async () => log);
}

afterEach(async () => {
  vi.restoreAllMocks();
  resetHttpReadyReport();
  config.unset("http");
  delete process.env[TEST_SERVER_PORT_ENV_KEY];
});

describe("HttpConnector.start — innocent cases publish exactly what they bind (unchanged)", () => {
  async function boundReportFor(configuredPort: unknown, mockAddress: string) {
    config.set("http", { port: configuredPort, host: "127.0.0.1" });

    silenceHttpLogs();

    const server = startHttpServer();
    vi.spyOn(server, "listen").mockImplementation(async () => mockAddress);

    const setServedPortSpy = vi.spyOn(Application, "setServedPort");

    const connector = new TestHttpConnector();
    connector.setHttp(server);

    await connector.start();

    return { report: getHttpReadyReport(), setServedPortSpy };
  }

  it("an ordinary configured port", async () => {
    const { report, setServedPortSpy } = await boundReportFor(47_501, "http://127.0.0.1:47501");

    expect(report?.port).toBe(47_501);
    expect(setServedPortSpy).toHaveBeenCalledWith(47_501);
  });

  it("a port normalised from a string ('03999')", async () => {
    const { report, setServedPortSpy } = await boundReportFor("03999", "http://127.0.0.1:3999");

    expect(report?.port).toBe(3_999);
    expect(setServedPortSpy).toHaveBeenCalledWith(3_999);
  });

  it("an absent http.port falling back to the default (3000)", async () => {
    const { report, setServedPortSpy } = await boundReportFor(undefined, "http://127.0.0.1:3000");

    expect(report?.port).toBe(3_000);
    expect(setServedPortSpy).toHaveBeenCalledWith(3_000);
  });
});

describe("HttpConnector.start — the card's own proof (http.port: 0)", () => {
  it("binds an OS-assigned port, publishes the REAL port, and a request against it succeeds", async () => {
    config.set("http", { port: 0, host: "127.0.0.1" });

    silenceHttpLogs();

    const server = startHttpServer();
    server.get("/ping", async () => ({ ok: true }));

    const connector = new TestHttpConnector();
    connector.setHttp(server);

    try {
      await connector.start();

      const report = getHttpReadyReport();

      // The defect: publishing the CONFIGURED port would report `0` here —
      // there is no such thing as "the OS-assigned port that was asked for".
      expect(report?.port).toBeGreaterThan(0);

      // `getTestServerUrl()` is the second half of the card: with no
      // `WARLOCK_TEST_SERVER_PORT` published (this spec runs in-process, not
      // through `startHttpTestServer`), it must fall back to the report's
      // truthful bound port rather than `config.key("http.port", 2031)`,
      // which would still read the configured `0`.
      const url = getTestServerUrl();

      expect(url).not.toMatch(/:0$/);
      expect(url).toBe(`http://127.0.0.1:${report?.port}`);

      const response = await fetch(`${url}/ping`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      await server.close();
    }
  });
});
