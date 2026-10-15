import { describe, expect, it } from "vitest";
import { startHttpServer } from "../../../src/http/server";
import type { HttpConfigurations } from "../../../src/http/types";

/**
 * WR-005: `http.serverOptions` is forwarded to Fastify, which hands its `http`
 * key to Node's `http.createServer()`. The config type must be able to say so.
 */
describe("http.serverOptions", () => {
  it("is typed on HttpConfigurations, including Node's native http options", () => {
    const httpConfigurations: HttpConfigurations = {
      serverOptions: {
        http: { maxHeaderSize: 32 * 1024 },
        keepAliveTimeout: 10_000,
      },
    };

    expect(httpConfigurations.serverOptions?.http?.maxHeaderSize).toBe(32768);
  });

  it("applies serverOptions.http.maxHeaderSize to the native server", () => {
    const server = startHttpServer({ http: { maxHeaderSize: 32 * 1024 } });

    expect(server.server.maxHeaderSize).toBe(32768);
  });
});
