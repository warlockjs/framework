import fastifyCookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { Response } from "./response";

describe("response.cookie() maxAge", () => {
  it("truncates a fractional maxAge before Cookie 11 serializes it", async () => {
    const app = Fastify();
    await app.register(fastifyCookie);

    app.get("/", (_request, reply) => {
      const response = new Response();
      response.baseResponse = reply;
      response.cookie("a", "b", { maxAge: 3600.5 });

      return reply.send("ok");
    });

    await app.ready();
    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.headers["set-cookie"]).toContain("Max-Age=3600");

    await app.close();
  });
});
