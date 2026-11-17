import type { LightMyRequestResponse } from "fastify";
import { describe, expect, it } from "vitest";
import { hashDashboardPath } from "../../../src/production/http/state";
import { createApp, HOST, ORIGIN, PASSWORD, PATH, type TestApp } from "./harness";

/** The headers of a response without the ones that differ per request. */
function comparable(response: LightMyRequestResponse): Record<string, unknown> {
  const { date: _date, ...rest } = response.headers;

  return rest;
}

/** What the app answers for a URL it does not serve. */
async function appNotFound(
  t: TestApp,
  method: "GET" | "POST" = "GET",
): Promise<LightMyRequestResponse> {
  return t.inject({
    method,
    url: "/random-unknown-url",
    ...(method === "POST" ? { payload: {} } : {}),
  });
}

async function close(t: TestApp, how: "disabled" | "locked"): Promise<void> {
  await t.store.state.update(
    0,
    how === "disabled"
      ? { disabled: true, disabledPathHash: hashDashboardPath(PATH) }
      : { lockedUntil: Date.now() + 60_000 },
  );
  t.state.invalidate();
}

describe("the uniform 404", () => {
  const closedCases: [string, (t: TestApp) => Promise<LightMyRequestResponse>][] = [
    ["the shell", (t) => t.send("GET", "/")],
    ["the session view", (t) => t.send("GET", "/api/auth/session")],
    ["a data route", (t) => t.send("GET", "/api/panels")],
    [
      "the login route",
      (t) => t.send("POST", "/api/auth/login", { body: { email: "a@b.c", password: "x" } }),
    ],
  ];

  it.each(closedCases)("answers the app's own 404 while disabled: %s", async (_name, call) => {
    const t = await createApp({ notFound: "custom", cors: true });

    await close(t, "disabled");

    const response = await call(t);
    const reference = await appNotFound(t);

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("app not found");
    expect(response.body).toBe(reference.body);
    expect(comparable(response)).toEqual(comparable(reference));
  });

  it.each(closedCases)("answers the app's own 404 while locked: %s", async (_name, call) => {
    const t = await createApp({ notFound: "custom" });

    await close(t, "locked");

    const response = await call(t);

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("app not found");
    expect(comparable(response)).toEqual(comparable(await appNotFound(t)));
  });

  it("answers the app's own 404 for an unknown asset, which needs no session", async () => {
    const t = await createApp({ notFound: "custom", cors: true });
    const response = await t.send("GET", "/assets/nope.js");
    const reference = await appNotFound(t);

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("app not found");
    expect(comparable(response)).toEqual(comparable(reference));
  });

  it("answers the same bytes as Fastify's default 404 for the same URL shape", async () => {
    const t = await createApp();

    await close(t, "disabled");

    const response = await t.send("GET", "/api/panels");
    const reference = await t.inject({ method: "GET", url: `${PATH}/api/panels-unknown` });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      message: `Route GET:${PATH}/api/panels not found`,
      error: "Not Found",
      statusCode: 404,
    });
    expect(Object.keys(response.headers).sort()).toEqual(Object.keys(reference.headers).sort());
  });

  it("answers the 404 when the request is not HTTPS", async () => {
    const t = await createApp({ notFound: "custom" });
    const response = await t.inject({
      method: "GET",
      url: `${PATH}/api/auth/session`,
      headers: { "x-forwarded-proto": "http" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("app not found");
    expect(comparable(response)).toEqual(comparable(await appNotFound(t)));
  });

  it("answers the 404 when the client IP is not allowed", async () => {
    const t = await createApp({
      notFound: "custom",
      production: { allowedIps: ["198.51.100.0/24"] },
    });
    const response = await t.send("GET", "/");

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("app not found");
    expect(comparable(response)).toEqual(comparable(await appNotFound(t)));
  });

  it("answers the 404 for a protected route without a session, with a dead token or the wrong cookie name", async () => {
    const t = await createApp({ notFound: "custom" });
    const reference = comparable(await appNotFound(t));

    const none = await t.send("GET", "/api/panels");
    const dead = await t.send("GET", "/api/panels", {
      session: { token: "x".repeat(43), csrf: "x", accountId: "x" },
    });
    const session = await t.signIn("viewer@example.com");
    const insecureName = await t.inject({
      method: "GET",
      url: `${PATH}/api/panels`,
      headers: { cookie: `warlock-devtools=${session.token}` },
    });

    for (const response of [none, dead, insecureName]) {
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe("app not found");
      expect(comparable(response)).toEqual(reference);
    }
  });

  it("answers the 404 to a session that has not finished signing in, on every data route", async () => {
    const t = await createApp({ notFound: "custom" });

    await t.addAccount("new@example.com", "viewer", {
      passwordSource: "reset",
      mustChangePassword: true,
    });

    const login = await t.send("POST", "/api/auth/login", {
      body: { email: "new@example.com", password: PASSWORD },
    });
    const step = login.json<{ stage: string; csrf: string }>();
    const token = /warlock-devtools=([^;]+)/.exec(String(login.headers["set-cookie"]))?.[1] ?? "";
    const pending = { token, csrf: step.csrf, accountId: "" };

    expect(step.stage).toBe("password-change");

    for (const route of [
      "/api/panels",
      "/api/requests",
      "/api/account",
      "/api/admin/users",
      "/api/stream",
    ]) {
      const response = await t.send("GET", route, { session: pending });

      expect(response.statusCode, route).toBe(404);
      expect(response.body, route).toBe("app not found");
    }

    // The step it needs next is reachable.
    const change = await t.send("POST", "/api/auth/password", {
      session: pending,
      body: { password: "a brand new password" },
    });

    expect(change.statusCode).toBe(200);
  });

  it("answers the 404 for a route the dashboard does not have", async () => {
    const t = await createApp({ notFound: "custom" });
    const response = await t.send("GET", "/api/nothing-here");

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("app not found");
  });

  it("answers the 404 for routes of a tab that is turned off, even when signed in", async () => {
    const t = await createApp({ notFound: "custom" });
    const session = await t.signIn("viewer@example.com");

    for (const route of [
      "/api/mails",
      "/api/ai",
      "/api/openapi.json",
      "/docs",
      "/api/background",
    ]) {
      const response = await t.send("GET", route, { session });

      expect(response.statusCode, route).toBe(404);
      expect(response.body, route).toBe("app not found");
    }
  });

  it("answers the 404 to a public POST from a foreign origin, and still lets the same origin sign in", async () => {
    const t = await createApp({ notFound: "custom" });
    const foreign = await t.send("POST", "/api/auth/login", {
      body: { email: "a@b.c", password: "x" },
      headers: { origin: "https://evil.example.com" },
    });
    const same = await t.send("POST", "/api/auth/login", {
      body: { email: "a@b.c", password: "x" },
    });

    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).toBe("app not found");
    expect(same.statusCode).toBe(401);
  });

  it("does not add dashboard headers to the 404 and leaves the app's CORS headers alone", async () => {
    const t = await createApp({ notFound: "custom", cors: true });
    const response = await t.send("GET", "/api/panels");

    expect(response.statusCode).toBe(404);

    for (const name of [
      "x-robots-tag",
      "referrer-policy",
      "x-frame-options",
      "content-security-policy",
      "cross-origin-opener-policy",
      "permissions-policy",
    ]) {
      expect(response.headers[name], name).toBeUndefined();
    }

    expect(response.headers["cache-control"]).toBeUndefined();
    // Exactly what the app gives any 404, CORS included.
    expect(comparable(response)).toEqual(comparable(await appNotFound(t)));
  });

  it("opens again as soon as the state allows it", async () => {
    const t = await createApp();

    await close(t, "locked");
    expect((await t.send("GET", "/")).statusCode).toBe(404);

    await t.store.state.update(1, { lockedUntil: null });
    t.state.invalidate();

    expect((await t.send("GET", "/")).statusCode).toBe(200);
    expect(HOST).toBe("app.example.com");
    expect(ORIGIN).toBe("https://app.example.com");
  });

  it("closes when the state cannot be read, and says so once in the log", async () => {
    const t = await createApp({ notFound: "custom" });

    t.store.state.read = async () => {
      throw new Error("database down");
    };
    t.state.invalidate();

    const first = await t.send("GET", "/");
    const second = await t.send("GET", "/");

    expect(first.statusCode).toBe(404);
    expect(second.statusCode).toBe(404);
    expect(t.warnings.filter((line) => line.includes("database down"))).toHaveLength(1);
  });
});
