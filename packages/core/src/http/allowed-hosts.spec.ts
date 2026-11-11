/**
 * `http.allowedHosts` refuses unknown hosts before routing; unset keeps every
 * host. `http.requestTimeout` bounds how long a client may take to send a
 * request.
 */
import config from "@mongez/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedHost } from "./allowed-hosts";
import { startHttpServer } from "./server";

// The first Fastify boot in a process can be slow on a cold transform cache.
vi.setConfig({ testTimeout: 120_000 });

async function hit(host: string, url = "/hello", headers: Record<string, string> = {}) {
  const server = startHttpServer();

  server.get("/hello", async () => ({ ok: true }));
  server.get("/health", async () => ({ ok: true }));

  try {
    return await server.inject({ method: "GET", url, headers: { host, ...headers } });
  } finally {
    await server.close();
  }
}

describe("isAllowedHost", () => {
  it("matches exact hosts and leading-dot suffixes, ignoring case and port", () => {
    const list = ["example.com", ".example.org"];

    expect(isAllowedHost("example.com", list)).toBe(true);
    expect(isAllowedHost("EXAMPLE.com:8080", list)).toBe(true);
    expect(isAllowedHost("www.example.com", list)).toBe(false);
    expect(isAllowedHost("example.org", list)).toBe(true);
    expect(isAllowedHost("api.example.org", list)).toBe(true);
    expect(isAllowedHost("evilexample.org", list)).toBe(false);
    expect(isAllowedHost("", list)).toBe(false);
  });

  it("handles IPv6 literals with a port", () => {
    expect(isAllowedHost("[::1]:3000", ["[::1]"])).toBe(true);
  });
});

describe("http.allowedHosts", () => {
  afterEach(() => {
    config.unset("http.allowedHosts");
    config.unset("http.trustProxy");
  });

  it("serves every host when unset", async () => {
    expect((await hit("anything.test")).statusCode).toBe(200);
  });

  it("refuses an unlisted host with 400", async () => {
    config.set("http.allowedHosts", ["example.com"]);

    const response = await hit("evil.test");

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("EC110");
  });

  it("serves a listed host", async () => {
    config.set("http.allowedHosts", ["example.com"]);

    expect((await hit("example.com")).statusCode).toBe(200);
  });

  it("keeps the health endpoint reachable by address", async () => {
    config.set("http.allowedHosts", ["example.com"]);

    expect((await hit("10.0.0.7:3000", "/health")).statusCode).toBe(200);
  });

  it("checks the forwarded host only when the proxy is trusted", async () => {
    config.set("http.allowedHosts", ["example.com"]);

    expect(
      (await hit("internal:3000", "/hello", { "x-forwarded-host": "example.com" })).statusCode,
    ).toBe(400);

    config.set("http.trustProxy", true);

    expect(
      (await hit("internal:3000", "/hello", { "x-forwarded-host": "example.com" })).statusCode,
    ).toBe(200);
  });

  it("refuses a malformed configuration at boot", () => {
    config.set("http.allowedHosts", "example.com");

    expect(() => startHttpServer()).toThrow(/http\.allowedHosts/);
  });
});

describe("http.requestTimeout", () => {
  afterEach(() => config.unset("http.requestTimeout"));

  it("bounds request sending by default", async () => {
    const server = startHttpServer();

    try {
      expect(server.server.requestTimeout).toBe(300_000);
    } finally {
      await server.close();
    }
  });

  it("follows http.requestTimeout, and 0 turns it off", async () => {
    config.set("http.requestTimeout", 0);

    const server = startHttpServer();

    try {
      expect(server.server.requestTimeout).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("lets serverOptions.requestTimeout win", async () => {
    config.set("http.requestTimeout", 10_000);

    const server = startHttpServer({ requestTimeout: 20_000 });

    try {
      expect(server.server.requestTimeout).toBe(20_000);
    } finally {
      await server.close();
    }
  });
});
