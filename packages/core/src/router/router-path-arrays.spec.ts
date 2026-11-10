/**
 * Every verb method accepts a path array and registers one route per path.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "./router";

const verbs = ["any", "get", "post", "put", "patch", "delete", "head", "options"] as const;

describe("router verb methods accept path arrays", () => {
  let server: FastifyInstance | undefined;

  beforeEach(() => {
    (router as any).routes = [];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await server?.close();
    server = undefined;
    (router as any).routes = [];
  });

  it.each(verbs)("%s registers every path of the array", (verb) => {
    (router as any)[verb](["/arr-a", "/arr-b"], (() => undefined) as any);

    const paths = router
      .list()
      .map((route: any) => route.path)
      .filter((path: string) => path.startsWith("/arr-"));

    expect(paths).toEqual(["/arr-a", "/arr-b"]);
  });

  it("answers each array path in the dev dispatcher", async () => {
    vi.spyOn(router as any, "handleRoute").mockImplementation(((route: any) =>
      async (_request: any, reply: any) => {
        reply.code(200).header("x-route", route.method + ":" + route.path);

        return { output: "ok", response: { baseResponse: undefined } };
      }) as any);
    router.get(["/dev-a", "/dev-b"], (() => undefined) as any);
    server = Fastify();
    router.scanDevServer(server);
    await server.ready();

    for (const path of ["/dev-a", "/dev-b"]) {
      const response = await server.inject({ method: "GET", url: path });

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-route"]).toBe("GET:" + path);
    }
  });
});
