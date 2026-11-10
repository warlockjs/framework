/**
 * `originalUrl` / `originalPath` keep what the client sent, while `url` and
 * `path` carry the normalized value (one terminal slash dropped).
 */
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { Request } from "./request";
import { normalizeRequestPath } from "../router/normalize-request-path";

function fromFastifyShape(originalUrl: string | undefined, url: string) {
  const request = new Request();

  request.setRequest({
    method: "GET",
    url,
    originalUrl,
    headers: {},
    query: {},
    params: {},
  } as never);

  return request;
}

describe("Request.originalUrl / originalPath", () => {
  it("keeps the trailing slash the client sent", () => {
    const request = fromFastifyShape("/docs/", "/docs");

    expect(request.path).toBe("/docs");
    expect(request.originalPath).toBe("/docs/");
    expect(request.originalUrl).toBe("/docs/");
  });

  it("matches path when the client sent no trailing slash", () => {
    const request = fromFastifyShape("/docs", "/docs");

    expect(request.originalPath).toBe("/docs");
  });

  it("keeps the query string in originalUrl and drops it from originalPath", () => {
    const request = fromFastifyShape("/docs/?page=2", "/docs?page=2");

    expect(request.originalUrl).toBe("/docs/?page=2");
    expect(request.originalPath).toBe("/docs/");
  });

  it("falls back to url when the server exposes no originalUrl", () => {
    const request = fromFastifyShape(undefined, "/a?x=1");

    expect(request.originalUrl).toBe("/a?x=1");
    expect(request.originalPath).toBe("/a");
  });

  it("holds on a real Fastify server with a rewriteUrl, including app rewrites", async () => {
    const server = Fastify({
      rewriteUrl: (req) => {
        const url = (req.url ?? "/").replace(/^\/v1/, "");
        const queryIndex = url.indexOf("?");

        return queryIndex === -1
          ? normalizeRequestPath(url)
          : normalizeRequestPath(url.slice(0, queryIndex)) + url.slice(queryIndex);
      },
    });

    server.get("/*", async (fastifyRequest) => {
      const request = new Request();
      request.setRequest(fastifyRequest as never);

      return {
        path: request.path,
        originalUrl: request.originalUrl,
        originalPath: request.originalPath,
      };
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/v1/site/?q=1" });

    expect(response.json()).toEqual({
      path: "/site?q=1",
      originalUrl: "/v1/site/?q=1",
      originalPath: "/v1/site/",
    });

    await server.close();
  });
});
