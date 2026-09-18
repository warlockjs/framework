import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import { registerHttpPlugins } from "../../../src/http/plugins";
import { startHttpServer, type FastifyInstance } from "../../../src/http/server";
import { Router } from "../../../src/router/router";

/**
 * Card 5fe541db: `application/x-www-form-urlencoded` bodies (Apple's OAuth
 * `form_post` callback, plain HTML forms) used to hit Fastify with no parser
 * registered for that content type and come back 415 — `request.input()`
 * never saw the posted fields.
 *
 * The shared `tests/integration/http/harness.ts` boots a bare Fastify
 * instance and never calls `registerHttpPlugins`, which is exactly the state
 * that reproduces the bug — this suite needs the plugins registered, so it
 * boots its own instance rather than widening the shared harness for one
 * content type.
 */

let server: FastifyInstance | undefined;
let sourceFile: string | undefined;

afterEach(async () => {
  if (sourceFile) {
    Router.getInstance().removeRoutesBySourceFile(sourceFile);
    sourceFile = undefined;
  }

  if (server) {
    await server.close();
    server = undefined;
  }

  delete (config.list() as Record<string, any>).http?.bodyLimit;
});

async function bootServerWithPlugins(register: (router: Router) => void) {
  const router = Router.getInstance();
  sourceFile = `urlencoded-body-${Math.random().toString(36).slice(2)}`;

  await router.withSourceFile(sourceFile, () => register(router));

  server = startHttpServer();

  await registerHttpPlugins(server);

  router.scan(server);

  await server.ready();

  return server;
}

describe("HTTP body parsing — application/x-www-form-urlencoded", () => {
  it("parses fields into request.input(), repeated keys becoming arrays", async () => {
    const http = await bootServerWithPlugins((router) => {
      router.post("/oauth/callback", ({ request, response }) =>
        response.success({
          code: request.input("code"),
          state: request.input("state"),
          tag: request.input("tag"),
        }),
      );
    });

    const result = await http.inject({
      method: "POST",
      url: "/oauth/callback",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "code=abc&state=xyz&tag=a&tag=b",
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      code: "abc",
      state: "xyz",
      tag: ["a", "b"],
    });
  });

  it("still parses JSON bodies identically", async () => {
    const http = await bootServerWithPlugins((router) => {
      router.post("/json-echo", ({ request, response }) =>
        response.success({ code: request.input("code") }),
      );
    });

    const result = await http.inject({
      method: "POST",
      url: "/json-echo",
      payload: { code: "abc" },
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ code: "abc" });
  });

  it("still parses multipart bodies identically", async () => {
    const http = await bootServerWithPlugins((router) => {
      router.post("/multipart-echo", ({ request, response }) =>
        response.success({ code: request.input("code") }),
      );
    });

    const boundary = "----warlockTestBoundary";
    const payload =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="code"\r\n\r\n` +
      `abc\r\n` +
      `--${boundary}--\r\n`;

    const result = await http.inject({
      method: "POST",
      url: "/multipart-echo",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ code: "abc" });
  });

  it("rejects an over-limit urlencoded body with the same status as an over-limit JSON body", async () => {
    config.set("http.bodyLimit", 10);

    const http = await bootServerWithPlugins((router) => {
      router.post("/urlencoded-limit", ({ response }) => response.success({}));
      router.post("/json-limit", ({ response }) => response.success({}));
    });

    const urlencodedResult = await http.inject({
      method: "POST",
      url: "/urlencoded-limit",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "code=this-is-longer-than-ten-bytes",
    });

    const jsonResult = await http.inject({
      method: "POST",
      url: "/json-limit",
      payload: { code: "this-is-longer-than-ten-bytes" },
    });

    expect(urlencodedResult.statusCode).toBe(jsonResult.statusCode);
    expect(urlencodedResult.statusCode).toBe(413);
  });
});
