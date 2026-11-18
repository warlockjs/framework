import { describe, expect, it } from "vitest";
import {
  readCookie,
  sessionCookie,
  sessionCookieName,
  shareCookie,
  shareCookieName,
} from "../../../src/production/http/cookie";
import {
  DEVTOOLS_SESSION_COOKIE,
  DEVTOOLS_SESSION_COOKIE_INSECURE,
} from "../../../src/production/http";
import { totpCode } from "../../../../core/src/encryption/totp";
import { createApp, HOST, ORIGIN, PASSWORD, PATH, TOTP_SECRET, tokenOf } from "./harness";

describe("sessionCookie", () => {
  it("is HttpOnly, SameSite=Strict, Secure and path-scoped, with no Domain and no lifetime", () => {
    const cookie = sessionCookie("abc", { path: PATH, secure: true });

    expect(cookie).toBe(
      `__Secure-warlock-devtools=abc; Path=${PATH}; HttpOnly; SameSite=Strict; Secure`,
    );
    expect(cookie).not.toMatch(/Domain|Max-Age|Expires/i);
  });

  it("uses the plain name and no Secure attribute when HTTPS is not required", () => {
    expect(sessionCookie("abc", { path: PATH, secure: false })).toBe(
      `warlock-devtools=abc; Path=${PATH}; HttpOnly; SameSite=Strict`,
    );
  });

  it("clears with an empty value, a zero lifetime and the same scope", () => {
    const cookie = sessionCookie(null, { path: PATH, secure: true });

    expect(cookie).toContain("__Secure-warlock-devtools=;");
    expect(cookie).toContain(`Path=${PATH}`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("names the cookie by mode", () => {
    expect(sessionCookieName(true)).toBe(DEVTOOLS_SESSION_COOKIE);
    expect(sessionCookieName(false)).toBe(DEVTOOLS_SESSION_COOKIE_INSECURE);
  });
});

describe("readCookie", () => {
  it("finds a cookie among others and ignores a name that only ends the same", () => {
    expect(readCookie("a=1; warlock-devtools=tok; b=2", "warlock-devtools")).toBe("tok");
    expect(readCookie("x-warlock-devtools=evil", "warlock-devtools")).toBeUndefined();
    expect(readCookie("warlock-devtools=", "warlock-devtools")).toBeUndefined();
    expect(readCookie(undefined, "warlock-devtools")).toBeUndefined();
  });
});

describe("the session cookie on the wire", () => {
  it("is set by login with the documented attributes, scoped to the dashboard path", async () => {
    const t = await createApp();

    await t.store.accounts.create({
      email: "viewer@example.com",
      role: "viewer",
      passwordHash: `hash:${PASSWORD}`,
      passwordSource: "user",
      mustChangePassword: false,
      totpSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      recoveryCodes: [],
      passkeys: [],
      failuresResetAt: null,
      lastLoginAt: null,
      createdBy: null,
    });

    const response = await t.send("POST", "/api/auth/login", {
      body: { email: "viewer@example.com", password: PASSWORD },
    });
    const header = String(response.headers["set-cookie"]);

    expect(response.statusCode).toBe(200);
    expect(header).toMatch(/^__Secure-warlock-devtools=[A-Za-z0-9_-]{43}; /);
    expect(header).toContain(`Path=${PATH};`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Secure");
    expect(header).not.toMatch(/Domain|Max-Age|Expires/i);
  });

  it("is cleared by logout", async () => {
    const t = await createApp();
    const session = await t.signIn("viewer@example.com");
    const response = await t.send("POST", "/api/auth/logout", { session });

    expect(response.statusCode).toBe(204);
    expect(String(response.headers["set-cookie"])).toContain("Max-Age=0");
    expect(tokenOf(response)).toBeUndefined();

    const after = await t.send("GET", "/api/panels", { session });

    expect(after.statusCode).toBe(404);
  });

  it("is cleared when the session view sees a cookie that matches no session", async () => {
    const t = await createApp();
    const response = await t.send("GET", "/api/auth/session", {
      session: { token: "dead-token", csrf: "x", accountId: "x" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mode: "production", stage: "signed-out" });
    expect(String(response.headers["set-cookie"])).toContain("Max-Age=0");
  });

  it("is minted again when the second factor completes (no fixation)", async () => {
    const t = await createApp();

    await t.addAccount("admin@example.com", "admin");

    const login = await t.send("POST", "/api/auth/login", {
      body: { email: "admin@example.com", password: PASSWORD },
    });
    const pendingToken = tokenOf(login);
    const step = login.json<{ stage: string; csrf: string }>();

    expect(step.stage).toBe("mfa-verify");

    const mfa = await t.send("POST", "/api/auth/mfa", {
      session: { token: pendingToken ?? "", csrf: step.csrf, accountId: "" },
      body: { code: totpCode(TOTP_SECRET, Date.now()) },
    });
    const activeToken = tokenOf(mfa);

    expect(mfa.json()).toMatchObject({ stage: "active" });
    expect(activeToken).toBeDefined();
    expect(activeToken).not.toBe(pendingToken);
    expect((await t.auth.authenticate(pendingToken))?.stage ?? null).not.toBe("active");
  });

  it("uses the plain cookie name with no Secure attribute when requireHttps is false", async () => {
    const t = await createApp({
      production: { requireHttps: false, origin: `http://${HOST}` },
    });

    await t.store.accounts.create({
      email: "viewer@example.com",
      role: "viewer",
      passwordHash: `hash:${PASSWORD}`,
      passwordSource: "user",
      mustChangePassword: false,
      totpSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      recoveryCodes: [],
      passkeys: [],
      failuresResetAt: null,
      lastLoginAt: null,
      createdBy: null,
    });

    const response = await t.inject({
      method: "POST",
      url: `${PATH}/api/auth/login`,
      remoteAddress: "127.0.0.1",
      headers: { host: HOST, origin: `http://${HOST}`, "x-forwarded-proto": "http" },
      payload: { email: "viewer@example.com", password: PASSWORD },
    });
    const header = String(response.headers["set-cookie"]);

    expect(response.statusCode).toBe(200);
    expect(header).toMatch(/^warlock-devtools=/);
    expect(header).not.toContain("Secure");
    expect(ORIGIN).toBe(`https://${HOST}`);
  });
});

describe("shareCookie", () => {
  it("is HttpOnly, SameSite=Strict, Secure, path-scoped and ends after its lifetime", () => {
    const cookie = shareCookie("id.1.sig", { path: PATH, secure: true, maxAgeSeconds: 3600.9 });

    expect(cookie).toBe(
      `__Secure-warlock-devtools-share=id.1.sig; Path=${PATH}; HttpOnly; SameSite=Strict; Secure; Max-Age=3600`,
    );
    expect(cookie).not.toMatch(/Domain/i);
  });

  it("uses the plain name and no Secure attribute when HTTPS is not required", () => {
    expect(shareCookieName(false)).toBe("warlock-devtools-share");
    expect(shareCookie("v", { path: PATH, secure: false, maxAgeSeconds: 5 })).toBe(
      `warlock-devtools-share=v; Path=${PATH}; HttpOnly; SameSite=Strict; Max-Age=5`,
    );
  });

  it("never lives less than a second and clears with a zero lifetime", () => {
    expect(shareCookie("v", { path: PATH, secure: true, maxAgeSeconds: 0 })).toContain("Max-Age=1");
    expect(shareCookie(null, { path: PATH, secure: true })).toContain("Max-Age=0");
  });
});
