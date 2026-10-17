import config from "@mongez/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheFake } from "./fakes/cache-fake";
import { mailFake } from "./fakes/mail-fake";
import { sendMail } from "../mail/send-mail";
import { type TestHttpServer, createTestHttpServer } from "./test-http-server";

let app: TestHttpServer | undefined;
let previousRateLimit: unknown;

beforeEach(async () => {
  previousRateLimit = config.get("http.rateLimit");
  // The rate-limit plugin's store lives in the cache; the fake gives it one.
  await cacheFake.install();
  mailFake.install();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  config.set("http.rateLimit", previousRateLimit);
  mailFake.restore();
  await cacheFake.restore();
});

describe("createTestHttpServer", () => {
  it("listens on an OS-assigned port and answers through the real router", async () => {
    app = await createTestHttpServer({
      routes: (router) =>
        router.post("/echo", ({ request, response }) =>
          response.success({ name: request.input("name") }),
        ),
    });

    expect(app.port).toBeGreaterThan(0);
    expect(app.url).toBe(`http://127.0.0.1:${app.port}`);

    const response = await app.post("/echo", { name: "Ada" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "Ada" });
  });

  it("runs the production plugins: the rate limiter counts through its real cache store", async () => {
    config.set("http.rateLimit", { max: 2, duration: 60_000 });

    app = await createTestHttpServer({
      routes: (router) => router.get("/limited", ({ response }) => response.success({ ok: true })),
    });

    const statuses = [];

    for (let attempt = 0; attempt < 3; attempt++) {
      statuses.push((await app.get("/limited")).status);
    }

    expect(statuses).toEqual([200, 200, 429]);
  });

  it("parses multipart bodies with the registered multipart plugin", async () => {
    app = await createTestHttpServer({
      routes: (router) =>
        router.post("/form", ({ request, response }) =>
          response.success({ title: request.input("title") }),
        ),
    });

    const form = new FormData();

    form.set("title", "From a form");

    const response = await app.request("/form", { method: "POST", body: form });

    expect(await response.json()).toEqual({ title: "From a form" });
  });

  it("lets the worker's fakes see what a handler did", async () => {
    app = await createTestHttpServer({
      routes: (router) =>
        router.post("/invite", async ({ request, response }) => {
          await sendMail({
            to: request.input("email"),
            subject: "You are invited",
            html: "<p>Welcome</p>",
          });

          return response.success({ sent: true });
        }),
    });

    await app.post("/invite", { email: "ada@example.test" });

    mailFake.assertSent({ to: "ada@example.test", subject: "You are invited" });
  });

  it("removes its routes on close, so the next server does not inherit them", async () => {
    app = await createTestHttpServer({
      routes: (router) => router.get("/temporary", ({ response }) => response.success()),
    });
    await app.close();

    app = await createTestHttpServer();

    expect((await app.get("/temporary")).status).toBe(404);
  });
});
