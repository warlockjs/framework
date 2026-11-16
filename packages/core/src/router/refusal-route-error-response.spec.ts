import config from "@mongez/config";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpErrorResponseFormatter } from "../http/error-response";
import { registerLazyStatic } from "../http/lazy-static";
import { refusalStatusOf } from "../http/refusal-dispatch";
import { startHttpServer } from "../http/server";
import { router } from "./router";

/** `inject()` normalises dot segments away, so this goes over a real socket. */
function get(
  port: number,
  url: string,
  accept: string,
): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: url, headers: { accept } }, (reply) => {
        let body = "";

        reply.on("data", (chunk) => (body += chunk));
        reply.on("end", () =>
          resolve({
            status: reply.statusCode ?? 0,
            type: String(reply.headers["content-type"] ?? ""),
            body,
          }),
        );
      })
      .on("error", reject);
  });
}

const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  router.removeRoutesBySourceFile("refusal-route-error-response.spec");
  vi.restoreAllMocks();
});

describe("http.errorResponse together with a route that handles refusals", () => {
  it("answers a document refusal once with the page, and formats the JSON refusal", async () => {
    const formatter: HttpErrorResponseFormatter = ({ status }) => ({ formatted: status });
    vi.spyOn(config, "get").mockImplementation(((key: string, fallback?: unknown) =>
      key === "http.errorResponse" ? formatter : fallback) as typeof config.get);
    const root = mkdtempSync(path.join(os.tmpdir(), "warlock-refusal-format-"));
    mkdirSync(path.join(root, "public"));
    writeFileSync(path.join(root, "public", "a.txt"), "a");

    await router.withSourceFile("refusal-route-error-response.spec", async () => {
      router.get(
        "*",
        async ({ request, response }) =>
          response.html(
            `<h1>page host ${refusalStatusOf(request)}</h1>`,
            refusalStatusOf(request) ?? 404,
          ),
        { name: "spec.refusal-format-catch-all", handlesRefusals: true },
      );
    });

    const server = startHttpServer();
    registerLazyStatic(server, { root: path.join(root, "public"), prefix: "/public/" });
    router.scan(server);
    await server.listen({ port: 0, host: "127.0.0.1" });
    closers.push(() => server.close());
    const { port } = server.server.address() as { port: number };

    const page = await get(port, "/public/../x", "text/html,*/*;q=0.8");

    expect(page.status).toBe(403);
    expect(page.type).toContain("text/html");
    expect(page.body).toBe("<h1>page host 403</h1>");

    const json = await get(port, "/public/../x", "application/json");

    expect(json.status).toBe(403);
    expect(JSON.parse(json.body)).toEqual({ formatted: 403 });
  });
});

describe("Router.dispatchRefusal after the page was handed to send()", () => {
  async function dispatch(raw: { headersSent: boolean }, sendsBeforeThrow: boolean) {
    await router.withSourceFile("refusal-route-error-response.spec", async () => {
      router.get("*", () => undefined, { name: "spec.refusal-guard", handlesRefusals: true });
    });
    const reply = { sent: false, raw, send: vi.fn() };

    vi.spyOn(
      router as unknown as { routeHandler: (...a: unknown[]) => unknown },
      "routeHandler",
    ).mockReturnValue((async (_request: unknown, replyArg: { send: (body: string) => void }) => {
      if (sendsBeforeThrow) replyArg.send("<h1>page</h1>");

      throw new Error("late failure");
    }) as never);

    const handled = await (
      router as never as {
        dispatchRefusal: (request: unknown, reply: unknown, status: number) => Promise<boolean>;
      }
    ).dispatchRefusal({ method: "GET", headers: { accept: "text/html" } }, reply, 403);

    return handled;
  }

  it("counts the reply as sent when send() ran but reply.sent is still false", async () => {
    expect(await dispatch({ headersSent: false }, true)).toBe(true);
  });

  it("counts the reply as sent once the headers went out", async () => {
    expect(await dispatch({ headersSent: true }, false)).toBe(true);
  });

  it("reports unhandled when the failure came before anything was written", async () => {
    expect(await dispatch({ headersSent: false }, false)).toBe(false);
  });
});
