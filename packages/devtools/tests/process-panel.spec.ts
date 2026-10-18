import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createCollector } from "../src/collector";
import { resolveDevtoolsOptions } from "../src/options";
import { mountDevtoolsRoutes } from "../src/server";

function server(development = true, rows?: readonly unknown[]) {
  const app = Fastify();
  const options = resolveDevtoolsOptions({});
  mountDevtoolsRoutes(app, {
    collector: createCollector(options),
    options,
    isDevelopment: () => development,
    processPanel: rows ? { list: async () => rows } : undefined,
  });
  return app;
}

describe("process panel", () => {
  it("returns the app's process list without caching it", async () => {
    const rows = [{ pid: 123, owner: "example-app", labels: { room: "one" } }];
    const app = server(true, rows);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/__warlock/api/processes",
        remoteAddress: "127.0.0.1",
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual(rows);
    } finally {
      await app.close();
    }
  });
  it("returns an empty list when the optional process package is absent", async () => {
    const app = server();
    try {
      expect(
        (await app.inject({ url: "/__warlock/api/processes", remoteAddress: "127.0.0.1" })).json(),
      ).toEqual([]);
    } finally {
      await app.close();
    }
  });
  it.each([
    { development: false, address: "127.0.0.1" },
    { development: true, address: "192.0.2.1" },
  ])("uses the development and loopback guards", async ({ development, address }) => {
    const app = server(development, []);
    try {
      expect(
        (await app.inject({ url: "/__warlock/api/processes", remoteAddress: address })).statusCode,
      ).not.toBe(200);
    } finally {
      await app.close();
    }
  });
});
