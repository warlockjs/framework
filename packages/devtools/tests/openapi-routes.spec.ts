import { readFileSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { mountDevtoolsRoutes } from "../src/server/index";
import type { MountDevtoolsRoutesDeps } from "../src/server/types";
import { resolveUiRoot } from "../src/ui-root";
import type { DevtoolsCollector, ResolvedDevtoolsOptions } from "../src/types";

const options: ResolvedDevtoolsOptions = {
  path: "/__warlock",
  maxRequests: 200,
  nPlusOneThreshold: 5,
};

const document = {
  openapi: "3.1.0",
  info: { title: "app", version: "1.0.0" },
  paths: { "/ping": { get: { operationId: "ping", responses: { "200": { description: "OK" } } } } },
};

function buildServer(overrides: Partial<MountDevtoolsRoutesDeps> = {}, development = true) {
  const server = Fastify();

  mountDevtoolsRoutes(server, {
    // None of the OpenAPI routes touch the collector.
    collector: {} as DevtoolsCollector,
    options,
    isDevelopment: () => development,
    ...overrides,
  });

  return server;
}

const loopback = "127.0.0.1";

describe("GET /api/openapi.json", () => {
  it("returns the document from the injected generator", async () => {
    const server = buildServer({ getOpenApiDocument: async () => document });

    const response = await server.inject({
      method: "GET",
      url: "/__warlock/api/openapi.json",
      remoteAddress: loopback,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual(document);
  });

  it("answers 503 with a JSON error when the host provides no generator", async () => {
    const server = buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/__warlock/api/openapi.json",
      remoteAddress: loopback,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: expect.stringContaining("not available") });
  });

  it("surfaces a generator failure as a JSON error", async () => {
    const server = buildServer({
      getOpenApiDocument: async () => {
        throw new Error("boom");
      },
    });

    const response = await server.inject({
      method: "GET",
      url: "/__warlock/api/openapi.json",
      remoteAddress: loopback,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "boom" });
  });
});

describe("GET /docs", () => {
  it("serves the Scalar page, wired with relative URLs", async () => {
    const server = buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/__warlock/docs",
      remoteAddress: loopback,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.body).toContain('data-url="api/openapi.json"');
    expect(response.body).toContain('src="assets/scalar.js"');
    expect(response.body).not.toMatch(/https?:\/\//);
    expect(response.body).not.toContain("<style");
  });
});

describe("Scalar asset", () => {
  it("serves the vendored Scalar bundle as JavaScript", async () => {
    const server = buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/__warlock/assets/scalar.js",
      remoteAddress: loopback,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    const vendored = readFileSync(path.join(resolveUiRoot(), "vendor", "scalar", "standalone.js"));

    expect(response.rawPayload.equals(vendored)).toBe(true);
  });

  it("does not expose other vendored or package files", async () => {
    const server = buildServer();

    for (const name of ["standalone.js", "scalar.js.map", "..%2Fpackage.json", "style.css"]) {
      const response = await server.inject({
        method: "GET",
        url: `/__warlock/assets/${name}`,
        remoteAddress: loopback,
      });

      expect(response.statusCode).toBe(404);
    }
  });
});

describe("GET /api/postman.json", () => {
  const collection = { info: { name: "app" }, item: [] };

  it("returns the collection from the injected generator", async () => {
    const server = buildServer({ getPostmanCollection: async () => collection });

    const response = await server.inject({
      method: "GET",
      url: "/__warlock/api/postman.json",
      remoteAddress: loopback,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual(collection);
  });

  it("answers 503 with a JSON error when the host provides no generator", async () => {
    const server = buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/__warlock/api/postman.json",
      remoteAddress: loopback,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: expect.stringContaining("not available") });
  });

  it("surfaces a generator failure as a JSON error", async () => {
    const server = buildServer({
      getPostmanCollection: async () => {
        throw new Error("boom");
      },
    });

    const response = await server.inject({
      method: "GET",
      url: "/__warlock/api/postman.json",
      remoteAddress: loopback,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "boom" });
  });
});

describe("GET /docs/swagger", () => {
  it("serves the Swagger UI page, wired to the whitelisted assets", async () => {
    const server = buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/__warlock/docs/swagger",
      remoteAddress: loopback,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.body).toContain('href="../assets/swagger-ui.css"');
    expect(response.body).toContain('src="../assets/swagger-ui-bundle.js"');
    expect(response.body).toContain('src="../assets/docs-swagger.js"');
    expect(response.body).toContain('id="swagger-ui"');
    expect(response.body).not.toMatch(/https?:\/\//);
    expect(response.body).not.toContain("<style");
    expect(response.body).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });
});

describe("Swagger UI assets", () => {
  const assets: [string, string, string[]][] = [
    [
      "swagger-ui-bundle.js",
      "text/javascript; charset=utf-8",
      ["vendor", "swagger-ui", "swagger-ui-bundle.js"],
    ],
    ["swagger-ui.css", "text/css; charset=utf-8", ["vendor", "swagger-ui", "swagger-ui.css"]],
    ["docs-swagger.js", "text/javascript; charset=utf-8", ["docs-swagger.js"]],
  ];

  it.each(assets)(
    "serves %s with its content type and the vendored bytes",
    async (name, type, file) => {
      const server = buildServer();

      const response = await server.inject({
        method: "GET",
        url: `/__warlock/assets/${name}`,
        remoteAddress: loopback,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe(type);
      expect(response.rawPayload.equals(readFileSync(path.join(resolveUiRoot(), ...file)))).toBe(
        true,
      );
    },
  );

  it("starts Swagger UI with the validator off and a relative document URL", () => {
    const script = readFileSync(path.join(resolveUiRoot(), "docs-swagger.js"), "utf8");

    expect(script).toContain('url: "../api/openapi.json"');
    expect(script).toContain("validatorUrl: null");
    expect(script).not.toMatch(/https?:\/\//);
  });

  it("does not expose other files in the vendored folder", async () => {
    const server = buildServer();

    for (const name of [
      "LICENSE",
      "NOTICE",
      "README.md",
      "swagger-ui-bundle.js.LICENSE.txt",
      "swagger-ui-bundle.js.map",
      "swagger-ui.css.map",
      "docs-swagger.html",
      "..%2Fpackage.json",
    ]) {
      const response = await server.inject({
        method: "GET",
        url: `/__warlock/assets/${name}`,
        remoteAddress: loopback,
      });

      expect(response.statusCode).toBe(404);
    }
  });
});

describe("OpenAPI routes stay behind the dev-only loopback guard", () => {
  const urls = [
    "/__warlock/api/openapi.json",
    "/__warlock/api/postman.json",
    "/__warlock/docs",
    "/__warlock/docs/swagger",
    "/__warlock/assets/scalar.js",
    "/__warlock/assets/swagger-ui-bundle.js",
    "/__warlock/assets/swagger-ui.css",
    "/__warlock/assets/docs-swagger.js",
  ];

  it("404s for a non-loopback address", async () => {
    const server = buildServer({
      getOpenApiDocument: async () => document,
      getPostmanCollection: async () => ({}),
    });

    for (const url of urls) {
      const response = await server.inject({
        method: "GET",
        url,
        remoteAddress: "10.0.0.5",
        headers: { "x-forwarded-for": loopback },
      });

      expect(response.statusCode).toBe(404);
      expect(response.body).toBe("");
    }
  });

  it("404s outside development", async () => {
    const server = buildServer(
      { getOpenApiDocument: async () => document, getPostmanCollection: async () => ({}) },
      false,
    );

    for (const url of urls) {
      const response = await server.inject({ method: "GET", url, remoteAddress: loopback });

      expect(response.statusCode).toBe(404);
      expect(response.body).toBe("");
    }
  });
});
