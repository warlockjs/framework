import fastifyCookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { flushPendingCookies } from "./flush-pending-cookies";

describe("flushPendingCookies", () => {
  it("sends a cookie set before a raw-path stream exactly once", async () => {
    const app = Fastify();
    await app.register(fastifyCookie);

    app.get("/", (request, reply) => {
      reply.setCookie("ab_bucket", "b", { path: "/" });
      reply.setCookie("session", "abc", { path: "/" });

      flushPendingCookies(reply);
      reply.hijack();
      reply.raw.writeHead(200, reply.getHeaders() as never);
      reply.raw.end("streamed");
    });

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.body).toBe("streamed");
    expect(response.headers["set-cookie"]).toEqual(["ab_bucket=b; Path=/; SameSite=Lax", "session=abc; Path=/; SameSite=Lax"]);

    await app.close();
  });

  it("does not duplicate cookies when onSend runs afterwards", async () => {
    const app = Fastify();
    await app.register(fastifyCookie);

    app.get("/", (request, reply) => {
      reply.setCookie("ab_bucket", "b", { path: "/" });
      flushPendingCookies(reply);
      flushPendingCookies(reply);

      return reply.send("buffered");
    });

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.headers["set-cookie"]).toEqual(["ab_bucket=b; Path=/; SameSite=Lax"]);

    await app.close();
  });
});
