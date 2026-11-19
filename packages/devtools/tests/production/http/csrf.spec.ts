import { describe, expect, it } from "vitest";
import { productionRouteAccess } from "../../../src/production/http/access";
import { createApp, ORIGIN, PATH, testPanel } from "./harness";

/** Unsafe routes a signed-in viewer or admin can reach, with a body each accepts or refuses. */
const UNSAFE: [method: "POST" | "PUT" | "PATCH" | "DELETE", route: string, admin: boolean][] = [
  ["POST", "/api/account/password", false],
  ["POST", "/api/account/totp/start", false],
  ["POST", "/api/account/totp/confirm", false],
  ["DELETE", "/api/account/totp", false],
  ["POST", "/api/account/recovery-codes", false],
  ["POST", "/api/account/passkey/options", false],
  ["POST", "/api/account/passkey/verify", false],
  ["DELETE", "/api/account/passkeys/x", false],
  ["DELETE", "/api/account/sessions/x", false],
  ["POST", "/api/admin/invites", true],
  ["DELETE", "/api/admin/invites/x", true],
  ["PATCH", "/api/admin/users/x", true],
  ["DELETE", "/api/admin/users/x", true],
  ["POST", "/api/admin/users/x/reset-mfa", true],
  ["POST", "/api/admin/users/x/sign-out", true],
  ["POST", "/api/admin/disable", true],
  ["DELETE", "/api/requests", true],
  ["POST", "/api/queries/abc/explain", true],
  ["POST", "/api/test-panel/items", true],
  ["DELETE", "/api/test-panel/items", true],
];

/** The error code of a response, or `""` when it answered without a JSON error. */
function codeOf(response: { body: string; json(): { code?: string } }): string {
  return response.body === "" ? "" : (response.json().code ?? "");
}

describe("CSRF and origin checks", () => {
  it("covers every unsafe route of the access table that a signed-in user can reach", () => {
    const listed = new Set(
      UNSAFE.map(([method, route]) => `${method} ${route.replace(/\/(x|abc)(?=\/|$)/g, "/:p")}`),
    );
    const table = productionRouteAccess(["test-panel"]).filter(
      (rule) =>
        rule.method !== "GET" &&
        rule.access.type !== "public" &&
        rule.access.type !== "pending" &&
        !rule.url.endsWith("/*") &&
        // Not registered in production (it spends a model call), so no signed-in user can reach it.
        !(rule.method === "POST" && rule.url === "/api/ai/evaluate") &&
        !(rule.url === "/api/test-panel" && rule.method !== "POST"),
    );

    // Every table row has a counterpart in UNSAFE (parameters compared by position, not name).
    const normalized = (url: string) => url.replace(/:[A-Za-z]+/g, ":p");
    const have = new Set([...listed].map((entry) => normalized(entry)));

    for (const rule of table) {
      if (rule.url === "/api/test-panel") continue;

      expect(have.has(`${rule.method} ${normalized(rule.url)}`), `${rule.method} ${rule.url}`).toBe(
        true,
      );
    }
  });

  describe.each(UNSAFE)("%s %s", (method, route, admin) => {
    const attempt = async (
      init: (session: { token: string; csrf: string; accountId: string }) => {
        headers?: Record<string, string>;
        body?: unknown;
      },
    ) => {
      const t = await createApp({ panels: [testPanel()] });
      const session = await t.signIn("user@example.com", admin ? "admin" : "viewer");
      const options = init(session);
      const response = await t.inject({
        method,
        url: `${PATH}${route}`,
        headers: {
          cookie: `__Secure-warlock-devtools=${session.token}`,
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { payload: options.body as object }),
      });

      return { response, session, t };
    };

    const csrfOf = (session: { csrf: string }) => ({ "x-devtools-csrf": session.csrf });

    it("refuses a missing Origin without fetch metadata", async () => {
      const { response } = await attempt((session) => ({ headers: csrfOf(session), body: {} }));

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: "csrf.invalid" });
    });

    it("refuses a foreign Origin", async () => {
      const { response } = await attempt((session) => ({
        headers: { ...csrfOf(session), origin: "https://evil.example.com" },
        body: {},
      }));

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: "csrf.invalid" });
    });

    it("refuses a cross-site Sec-Fetch-Site even with the right Origin", async () => {
      const { response } = await attempt((session) => ({
        headers: { ...csrfOf(session), origin: ORIGIN, "sec-fetch-site": "cross-site" },
        body: {},
      }));

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: "csrf.invalid" });
    });

    it("refuses a missing token", async () => {
      const { response } = await attempt(() => ({ headers: { origin: ORIGIN }, body: {} }));

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: "csrf.invalid" });
    });

    it("refuses a wrong token, including another session's", async () => {
      const wrong = await attempt(() => ({
        headers: { origin: ORIGIN, "x-devtools-csrf": "not-the-token" },
        body: {},
      }));

      expect(wrong.response.statusCode).toBe(403);
      expect(wrong.response.json()).toMatchObject({ code: "csrf.invalid" });

      const other = await wrong.t.signIn("other@example.com", admin ? "admin" : "viewer");
      const crossed = await wrong.t.inject({
        method,
        url: `${PATH}${route}`,
        headers: {
          cookie: `__Secure-warlock-devtools=${wrong.session.token}`,
          origin: ORIGIN,
          "x-devtools-csrf": other.csrf,
        },
        payload: {},
      });

      expect(crossed.statusCode).toBe(403);
      expect(crossed.json()).toMatchObject({ code: "csrf.invalid" });
    });

    it("refuses a body that is not JSON", async () => {
      const { response } = await attempt((session) => ({
        headers: { ...csrfOf(session), origin: ORIGIN, "content-type": "text/plain" },
        body: "plain" as never,
      }));

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: "input.invalid" });
    });

    it("passes the gate with the right Origin and token", async () => {
      const { response } = await attempt((session) => ({
        headers: { ...csrfOf(session), origin: ORIGIN },
        body: {},
      }));

      expect(codeOf(response)).not.toBe("csrf.invalid");
      expect(codeOf(response)).not.toBe("role.forbidden");
    });

    it("accepts same-origin fetch metadata in place of an Origin header", async () => {
      const { response } = await attempt((session) => ({
        headers: { ...csrfOf(session), "sec-fetch-site": "same-origin" },
        body: {},
      }));

      expect(codeOf(response)).not.toBe("csrf.invalid");
    });
  });

  it("answers the uniform 404 when a request without a session fails the origin check", async () => {
    const t = await createApp({ notFound: "custom" });
    const response = await t.inject({
      method: "POST",
      url: `${PATH}/api/auth/login`,
      headers: { origin: "https://evil.example.com" },
      payload: { email: "a@b.c", password: "x" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("app not found");
  });

  it("does not need a token on the public sign-in routes, only the origin", async () => {
    const t = await createApp();
    const missingOrigin = await t.inject({
      method: "POST",
      url: `${PATH}/api/auth/login`,
      payload: { email: "a@b.c", password: "x" },
    });
    const ok = await t.send("POST", "/api/auth/login", { body: { email: "a@b.c", password: "x" } });

    expect(missingOrigin.statusCode).toBe(404);
    expect(ok.statusCode).toBe(401);
    expect(ok.json()).toMatchObject({ code: "auth.invalid-credentials" });
  });

  it("answers input.invalid for a body that is not an object", async () => {
    const t = await createApp();
    const response = await t.inject({
      method: "POST",
      url: `${PATH}/api/auth/login`,
      headers: { origin: ORIGIN, "content-type": "application/json" },
      payload: JSON.stringify(["not", "an", "object"]),
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "input.invalid" });
  });

  it("answers input.invalid for malformed JSON and an empty JSON body", async () => {
    const t = await createApp();

    for (const payload of ["{broken", ""]) {
      const response = await t.inject({
        method: "POST",
        url: `${PATH}/api/auth/login`,
        headers: { origin: ORIGIN, "content-type": "application/json" },
        payload,
      });

      expect(response.statusCode, payload).toBeGreaterThanOrEqual(400);
      expect(response.json(), payload).toMatchObject({ code: "input.invalid" });
    }
  });

  it("does not require JSON when a request has no body", async () => {
    const t = await createApp();
    const session = await t.signIn("viewer@example.com");
    const response = await t.send("POST", "/api/auth/logout", { session });

    expect(response.statusCode).toBe(204);
  });

  it("never changes state on a GET: the CSRF header is not needed, the Origin is not read", async () => {
    const t = await createApp();
    const session = await t.signIn("viewer@example.com");
    const response = await t.inject({
      method: "GET",
      url: `${PATH}/api/panels`,
      headers: {
        cookie: `__Secure-warlock-devtools=${session.token}`,
        origin: "https://evil.example.com",
      },
    });

    expect(response.statusCode).toBe(200);
  });
});
