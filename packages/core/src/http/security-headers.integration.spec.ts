import config from "@mongez/config";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheFake } from "../tests/fakes/cache-fake";
import { type TestHttpServer, createTestHttpServer } from "../tests/test-http-server";

let app: TestHttpServer | undefined;
const previousEnv = process.env.NODE_ENV;
const touched = [
  "http.securityHeaders",
  "http.csp",
  "http.rateLimit",
  "http.bodyLimit",
  "storage.publicRoot",
];
let previous: Record<string, unknown> = {};

beforeEach(async () => {
  previous = Object.fromEntries(touched.map((key) => [key, config.get(key)]));
  await cacheFake.install();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  process.env.NODE_ENV = previousEnv;
  for (const key of touched) config.set(key, previous[key]);
  await cacheFake.restore();
});

function expectDefaults(response: Response) {
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  expect(response.headers.get("permissions-policy")).toContain("camera=()");
}

describe("security headers on the test server", () => {
  it("covers a routed response and a 404", async () => {
    app = await createTestHttpServer({
      routes: (router) => router.get("/hello", ({ response }) => response.success({ ok: true })),
    });

    expectDefaults(await app.get("/hello"));
    const missing = await app.get("/nothing-here");

    expect(missing.status).toBe(404);
    expectDefaults(missing);
  });

  it("covers a static file", async () => {
    const root = await mkdtemp(join(tmpdir(), "wl-headers-"));

    await writeFile(join(root, "a.txt"), "hello");
    config.set("storage.publicRoot", root);
    config.set("storage.publicPrefix", "/public/");

    app = await createTestHttpServer();

    const response = await app.get("/public/a.txt");

    expect(response.status).toBe(200);
    expectDefaults(response);
  });

  it("covers early refusals: 413 body limit and 429 rate limit", async () => {
    config.set("http.bodyLimit", 10);
    config.set("http.rateLimit", { max: 1, duration: 60_000 });

    app = await createTestHttpServer({
      routes: (router) => router.post("/echo", ({ response }) => response.success({ ok: true })),
    });

    const tooLarge = await app.post("/echo", { text: "x".repeat(100) });

    expect(tooLarge.status).toBe(413);
    expectDefaults(tooLarge);

    const limited = await app.post("/echo", { a: 1 });

    expect(limited.status).toBe(429);
    expectDefaults(limited);
  });

  it("keeps the headers when a handler calls reply.raw.writeHead", async () => {
    app = await createTestHttpServer({
      routes: (router) =>
        router.get("/raw", ({ response }) => {
          const raw = response.baseResponse.raw;

          raw.writeHead(200, { "Content-Type": "text/plain" });
          raw.end("raw");

          return response.baseResponse as never;
        }),
    });

    const response = await app.get("/raw");

    expect(await response.text()).toBe("raw");
    expectDefaults(response);
  });

  it("honours a per-route override and opt-out", async () => {
    app = await createTestHttpServer({
      routes: (router) => {
        router.get("/widget", ({ response }) => response.success(), {
          securityHeaders: { frameAncestors: ["https://partner.example.com"] },
        });
        router.get("/bare", ({ response }) => response.success(), { securityHeaders: false });
      },
    });

    const widget = await app.get("/widget");

    expect(widget.headers.get("content-security-policy")).toBe(
      "frame-ancestors https://partner.example.com",
    );
    expect(widget.headers.get("x-frame-options")).toBeNull();
    expect(widget.headers.get("x-content-type-options")).toBe("nosniff");

    const bare = await app.get("/bare");

    expect(bare.headers.get("x-content-type-options")).toBeNull();
    expect(bare.headers.get("content-security-policy")).toBeNull();
  });

  it("emits one CSP header with frame-ancestors once when http.csp is on", async () => {
    config.set("http.csp", { enabled: true });
    app = await createTestHttpServer({
      routes: (router) => router.get("/page", ({ response }) => response.success()),
    });

    const csp = (await app.get("/page")).headers.get("content-security-policy") ?? "";

    expect(csp.match(/frame-ancestors/g)).toHaveLength(1);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it("can be disabled, wholly or per header", async () => {
    config.set("http.securityHeaders", { frameAncestors: false, referrerPolicy: false });
    app = await createTestHttpServer({
      routes: (router) => router.get("/x", ({ response }) => response.success()),
    });

    const partial = await app.get("/x");

    expect(partial.headers.get("x-frame-options")).toBeNull();
    expect(partial.headers.get("referrer-policy")).toBeNull();
    expect(partial.headers.get("x-content-type-options")).toBe("nosniff");
    await app.close();

    config.set("http.securityHeaders", false);
    app = await createTestHttpServer({
      routes: (router) => router.get("/y", ({ response }) => response.success()),
    });

    const none = await app.get("/y");

    expect(none.headers.get("x-content-type-options")).toBeNull();
    expect(none.headers.get("permissions-policy")).toBeNull();
  });

  it("sends HSTS in production only", async () => {
    app = await createTestHttpServer({
      routes: (router) => router.get("/h", ({ response }) => response.success()),
    });
    expect((await app.get("/h")).headers.get("strict-transport-security")).toBeNull();

    process.env.NODE_ENV = "production";
    expect((await app.get("/h")).headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });
});
