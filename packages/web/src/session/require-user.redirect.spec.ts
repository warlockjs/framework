import Fastify from "fastify";
import config from "@mongez/config";
import { describe, expect, it } from "vitest";
import { Request, Response, requestContext } from "@warlock.js/core";
import { connectPageContext, renderPageRequest } from "../server/index";
import { connectSharedStore } from "../shared";
import { requireGuest, requireUser } from "./require-user";

describe.each([
  { label: "plain fastify (no onSend hook)", asyncOnSend: false },
  { label: "fastify with an async onSend hook (as core's compression adds)", asyncOnSend: true },
])("middleware redirect through the page pipeline: $label", ({ asyncOnSend }) => {
  async function run(kind: "user" | "guest") {
    connectPageContext(requestContext as never);
    connectSharedStore(() => requestContext.getStore() as never);
    config.set("web.session", {
      resolve: async () => (kind === "guest" ? { model: { id: 1 } } : undefined),
    });
    const app = Fastify();
    if (asyncOnSend) {
      app.addHook("onSend", async (_req, _reply, payload) => {
        await new Promise((r) => setImmediate(r));
        return payload;
      });
    }
    const seen: Record<string, unknown> = {};
    app.get("/staff", async (fastifyRequest, reply) => {
      const request = new Request();
      const response = new Response();
      response.setResponse(reply as never);
      (request as any).response = response;
      (response as any).request = request;
      request.setRequest(fastifyRequest as never);
      const middleware =
        kind === "user" ? requireUser({ loginPath: "/login" }) : requireGuest({ to: "/home" });
      const entry = {
        path: "/staff",
        name: "staff",
        triple: { app: { middleware: [middleware] }, layout: {}, page: { default: () => null } },
      };
      try {
        await renderPageRequest("/staff", {
          routes: [entry as never],
          createHttp: () => ({ request, response }),
        });
      } catch (error) {
        seen.renderThrew = (error as Error).message;
      }
      return reply;
    });
    const res = await app.inject({ method: "GET", url: "/staff" });
    await app.close();
    return { res, seen };
  }

  it("requireUser answers one 302 and does not throw while rendering", async () => {
    const { res, seen } = await run("user");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("/login");
    expect(seen.renderThrew).toBeUndefined();
  });

  it("requireGuest answers one 302 and does not throw while rendering", async () => {
    const { res, seen } = await run("guest");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/home");
    expect(seen.renderThrew).toBeUndefined();
  });
});
