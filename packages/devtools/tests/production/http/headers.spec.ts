import { describe, expect, it } from "vitest";
import { createApp, ORIGIN, PATH } from "./harness";

const BASE = [
  "cache-control",
  "x-robots-tag",
  "referrer-policy",
  "x-content-type-options",
  "x-frame-options",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
] as const;

describe("dashboard response headers", () => {
  it("sends the security headers on JSON answers, errors and the redirect", async () => {
    const t = await createApp();
    const session = await t.signIn("viewer@example.com");
    const answers = [
      await t.send("GET", "/api/panels", { session }),
      await t.send("GET", "/api/admin/users", { session }),
      await t.send("POST", "/api/auth/login", { body: { email: "a@b.c", password: "x" } }),
      await t.inject({ method: "GET", url: PATH }),
    ];

    for (const response of answers) {
      for (const name of BASE)
        expect(response.headers[name], `${response.statusCode} ${name}`).toBeDefined();
    }

    const { headers } = answers[0] as (typeof answers)[number];

    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(headers["permissions-policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
    );
  });

  it("adds the content security policy to HTML only", async () => {
    const t = await createApp();
    const shell = await t.send("GET", "/");
    const json = await t.send("GET", "/api/auth/session");
    const policy = String(shell.headers["content-security-policy"]);

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toMatch(/script-src[^;]*unsafe/);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(json.headers["content-security-policy"]).toBeUndefined();
  });

  it("strips every access-control header even when the app registers CORS for all routes", async () => {
    const t = await createApp({ cors: true });
    const session = await t.signIn("viewer@example.com");
    const reference = await t.inject({ method: "GET", url: "/app-route" });

    expect(reference.headers["access-control-allow-origin"]).toBe("*");

    for (const response of [
      await t.send("GET", "/", {}),
      await t.send("GET", "/api/auth/session"),
      await t.send("GET", "/api/panels", { session }),
      await t.send("GET", "/api/admin/users", { session }),
      await t.send("POST", "/api/auth/login", { body: { email: "a@b.c", password: "x" } }),
    ]) {
      const leaked = Object.keys(response.headers).filter((name) =>
        name.startsWith("access-control-"),
      );

      expect(leaked, `${response.statusCode}`).toEqual([]);
    }
  });

  it("does not answer a preflight request", async () => {
    const t = await createApp({ notFound: "custom" });
    const response = await t.inject({
      method: "OPTIONS",
      url: `${PATH}/api/auth/login`,
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-devtools-csrf",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("leaves the headers of the app's own routes alone", async () => {
    const t = await createApp();
    const response = await t.inject({ method: "GET", url: "/app-route" });

    expect(response.headers["x-robots-tag"]).toBeUndefined();
    expect(response.headers["content-security-policy"]).toBeUndefined();
  });

  it("allows the mail preview to be framed by the dashboard only, under its own sandbox policy", async () => {
    const collector = {
      listMails: () => [],
      getMail: () => ({ id: "m1", html: "<b>hello</b>", to: [], subject: "s", capturedAt: 1 }),
      subscribe: () => () => undefined,
    };
    const t = await createApp({
      builtInPanels: ["requests", "mail"],
      routes: { collector },
    });
    const session = await t.signIn("viewer@example.com");
    const response = await t.send("GET", "/api/mails/m1/html", { session });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(String(response.headers["content-security-policy"])).toContain("sandbox");
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
  });

  it("gives the API documentation pages the policy they need and still blocks framing elsewhere", async () => {
    const t = await createApp({ builtInPanels: ["requests", "api"] });
    const session = await t.signIn("viewer@example.com");
    const docs = await t.send("GET", "/docs", { session });

    expect(docs.statusCode).toBe(200);
    expect(String(docs.headers["content-security-policy"])).toContain(
      "script-src 'self' 'unsafe-inline'",
    );
    expect(String(docs.headers["content-security-policy"])).toContain("frame-ancestors 'none'");
    expect(docs.headers["x-frame-options"]).toBe("DENY");
    expect(ORIGIN).toBe("https://app.example.com");
  });
});
