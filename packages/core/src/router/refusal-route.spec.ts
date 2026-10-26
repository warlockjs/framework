import Fastify from "fastify";
import http from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { refusalStatusOf } from "../http/refusal-dispatch";
import { registerLazyStatic } from "../http/lazy-static";
import { router } from "./router";

function get(port: number, url: string, accept: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: url, headers: { accept } }, (reply) => {
        let body = "";

        reply.on("data", (chunk) => (body += chunk));
        reply.on("end", () => resolve({ status: reply.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  router.removeRoutesBySourceFile("refusal-route.spec");
});

describe("router: a route marked handlesRefusals", () => {
  it("answers a path-traversal 403 for a document request and leaves JSON requests alone", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "warlock-refusal-route-"));
    mkdirSync(path.join(root, "public"));
    writeFileSync(path.join(root, "public", "a.txt"), "a");

    await router.withSourceFile("refusal-route.spec", async () => {
      router.get(
        "*",
        async ({ request, response }) =>
          response.html(
            `<h1>page host ${refusalStatusOf(request)}</h1>`,
            refusalStatusOf(request) ?? 404,
          ),
        { name: "spec.refusal-catch-all", handlesRefusals: true },
      );
    });

    const server = Fastify();
    registerLazyStatic(server, { root: path.join(root, "public"), prefix: "/public/" });
    router.scan(server);
    await server.listen({ port: 0, host: "127.0.0.1" });
    closers.push(() => server.close());
    const { port } = server.server.address() as { port: number };

    const page = await get(port, "/public/../x", "text/html,*/*;q=0.8");

    expect(page.status).toBe(403);
    expect(page.body).toBe("<h1>page host 403</h1>");

    const json = await get(port, "/public/../x", "application/json");

    expect(json.status).toBe(403);
    expect(JSON.parse(json.body)).toMatchObject({ statusCode: 403, error: "Forbidden" });
  });
});
