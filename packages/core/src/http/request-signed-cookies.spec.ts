/**
 * Signed cookies: `response.cookie(..., { signed: true })` signs with
 * `http.cookies.secret`, `request.signedCookie()` verifies, and a tampered
 * value never comes back. `request.cookie(..., { json: false })` returns the
 * raw string instead of a client-chosen type.
 */
import fastifyCookie from "@fastify/cookie";
import config from "@mongez/config";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { Request } from "./request";
import { Response } from "./response";

async function appWithCookies(secret?: string) {
  const app = Fastify();

  await app.register(fastifyCookie, secret ? { secret } : {});

  app.get("/write", (_request, reply) => {
    const response = new Response();
    response.baseResponse = reply;

    try {
      response.cookie("role", "member", { signed: true });
    } catch (error) {
      return reply.send({ error: (error as Error).message });
    }

    return reply.send("ok");
  });

  app.get("/read", (baseRequest) => {
    const request = new Request().setRequest(baseRequest);

    try {
      return { role: request.signedCookie("role", null) ?? null };
    } catch (error) {
      return { error: (error as Error).message };
    }
  });

  await app.ready();

  return app;
}

function cookieValue(setCookie: string | string[] | undefined, name: string): string {
  const header = (Array.isArray(setCookie) ? setCookie : [setCookie ?? ""]).find((entry) =>
    entry.startsWith(`${name}=`),
  );

  return decodeURIComponent((header ?? "").split(";")[0]!.slice(name.length + 1));
}

describe("signed cookies", () => {
  it("round-trips a signed cookie through signedCookie()", async () => {
    const app = await appWithCookies("a-long-enough-cookie-secret-for-tests");
    const written = await app.inject({ method: "GET", url: "/write" });
    const value = cookieValue(written.headers["set-cookie"], "role");

    const read = await app.inject({
      method: "GET",
      url: "/read",
      cookies: { role: value },
    });

    expect(read.json()).toEqual({ role: "member" });

    await app.close();
  });

  it("refuses a value the client changed", async () => {
    const app = await appWithCookies("a-long-enough-cookie-secret-for-tests");
    const written = await app.inject({ method: "GET", url: "/write" });
    const value = cookieValue(written.headers["set-cookie"], "role");
    const forged = value.replace("member", "admin");

    const read = await app.inject({ method: "GET", url: "/read", cookies: { role: forged } });

    expect(read.json()).toEqual({ role: null });

    const unsigned = await app.inject({
      method: "GET",
      url: "/read",
      cookies: { role: JSON.stringify("admin") },
    });

    expect(unsigned.json()).toEqual({ role: null });

    await app.close();
  });

  it("names http.cookies.secret when signing or verifying without it", async () => {
    const app = await appWithCookies();

    const written = await app.inject({ method: "GET", url: "/write" });
    expect(written.json().error).toMatch(/http\.cookies\.secret/);

    const read = await app.inject({ method: "GET", url: "/read", cookies: { role: "x" } });
    expect(read.json().error).toMatch(/http\.cookies\.secret/);

    await app.close();
  });
});

describe("request.cookie json option", () => {
  afterEach(() => config.set("http.cookies", undefined));

  function requestWith(cookies: Record<string, string>) {
    return new Request().setRequest({
      method: "GET",
      url: "/",
      headers: {},
      query: {},
      params: {},
      cookies,
    } as never);
  }

  it("parses JSON by default", () => {
    expect(requestWith({ theme: '{"a":1}' }).cookie("theme")).toEqual({ a: 1 });
  });

  it("returns the raw string with { json: false }", () => {
    expect(requestWith({ theme: '{"a":1}' }).cookie("theme", undefined, { json: false })).toBe(
      '{"a":1}',
    );
  });

  it("returns the raw string when http.cookies.json is false", () => {
    config.set("http.cookies", { json: false });

    expect(requestWith({ count: "5" }).cookie("count")).toBe("5");
  });
});
