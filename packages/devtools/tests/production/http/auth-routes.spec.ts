import { describe, expect, it, vi } from "vitest";
import { totpCode } from "../../../../core/src/encryption/totp";
import { createApp, PASSWORD, tokenOf, TOTP_SECRET, type TestApp } from "./harness";

const SETUP_TOKEN = "s".repeat(40);

function sessionOf(
  response: { headers: Record<string, unknown>; json(): unknown },
  current?: string,
) {
  return {
    token: tokenOf(response as never) ?? current ?? "",
    csrf: (response.json() as { csrf: string }).csrf,
    accountId: "",
  };
}

describe("sign-in routes with the real service", () => {
  it("answers one message for a wrong password and an unknown email", async () => {
    const t = await createApp();

    await t.addAccount("known@example.com");

    const wrong = await t.send("POST", "/api/auth/login", {
      body: { email: "known@example.com", password: "not the password" },
    });
    const unknown = await t.send("POST", "/api/auth/login", {
      body: { email: "nobody@example.com", password: "not the password" },
    });

    expect(wrong.statusCode).toBe(401);
    const { ref: _wrongRef, ...wrongBody } = wrong.json<Record<string, string>>();
    const { ref: _unknownRef, ...unknownBody } = unknown.json<Record<string, string>>();

    expect(wrongBody).toEqual(unknownBody);
    expect(wrong.json()).toMatchObject({ code: "auth.invalid-credentials" });
    expect(tokenOf(wrong)).toBeUndefined();
  });

  it("validates the sign-in body", async () => {
    const t = await createApp();

    for (const body of [
      {},
      { email: "a@b.co" },
      { email: "a@b.co", password: "" },
      { email: "x", password: "y" },
      { email: "a@b.co", password: 5 },
      { email: "a@b.co", password: "x".repeat(2000) },
    ]) {
      const response = await t.send("POST", "/api/auth/login", { body });

      expect(response.statusCode, JSON.stringify(body).slice(0, 60)).toBe(422);
      expect(response.json()).toMatchObject({ code: "input.invalid" });
    }
  });

  it("walks a setup-token admin through password, authenticator enrolment and recovery codes", async () => {
    const t = await createApp({
      env: { DEVTOOLS_ADMIN_EMAIL: "root@example.com", DEVTOOLS_SETUP_TOKEN: SETUP_TOKEN },
    });

    await t.auth.ensureFirstAdmin();

    const wrongToken = await t.send("POST", "/api/auth/setup", {
      body: { token: "x".repeat(40), password: PASSWORD },
    });

    expect(wrongToken.statusCode).toBe(401);
    expect(wrongToken.json()).toMatchObject({ code: "auth.invalid-setup-token" });

    const setup = await t.send("POST", "/api/auth/setup", {
      body: { token: SETUP_TOKEN, password: PASSWORD },
    });

    expect(setup.statusCode).toBe(200);
    expect(setup.json()).toMatchObject({ stage: "mfa-enrol" });

    const enrolling = sessionOf(setup);
    const start = await t.send("POST", "/api/auth/totp/start", { session: enrolling });

    expect(start.statusCode).toBe(200);
    expect(start.json()).toMatchObject({ secret: TOTP_SECRET, account: "root@example.com" });
    expect(JSON.stringify(start.json())).toContain("otpauth://totp/");

    const wrongCode = await t.send("POST", "/api/auth/totp/confirm", {
      session: enrolling,
      body: { code: "000000" },
    });

    expect(wrongCode.statusCode).toBe(401);
    expect(wrongCode.json()).toMatchObject({ code: "auth.invalid-code" });

    const confirm = await t.send("POST", "/api/auth/totp/confirm", {
      session: enrolling,
      body: { code: totpCode(TOTP_SECRET, Date.now()) },
    });
    const body = confirm.json<{ stage: string; csrf: string; recoveryCodes: string[] }>();

    expect(confirm.statusCode).toBe(200);
    expect(body.stage).toBe("active");
    expect(body.recoveryCodes).toHaveLength(10);
    // A new session is minted on reaching active.
    expect(tokenOf(confirm)).toBeDefined();
    expect(tokenOf(confirm)).not.toBe(enrolling.token);

    const active = sessionOf(confirm);

    expect((await t.send("GET", "/api/admin/users", { session: active })).statusCode).toBe(200);
  });

  it("makes an env-password admin change the password first", async () => {
    const t = await createApp({
      env: {
        DEVTOOLS_ADMIN_EMAIL: "root@example.com",
        DEVTOOLS_ADMIN_PASSWORD: "initial password",
      },
    });

    await t.auth.ensureFirstAdmin();

    const login = await t.send("POST", "/api/auth/login", {
      body: { email: "root@example.com", password: "initial password" },
    });

    expect(login.json()).toMatchObject({ stage: "password-change" });

    const session = sessionOf(login);
    const same = await t.send("POST", "/api/auth/password", {
      session,
      body: { password: "initial password" },
    });

    expect(same.statusCode).toBe(422);
    expect(same.json()).toMatchObject({ code: "auth.password-unchanged" });

    const changed = await t.send("POST", "/api/auth/password", {
      session,
      body: { password: "a different password" },
    });

    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ stage: "mfa-enrol" });
  });

  it("verifies a recovery code in place of a code, and refuses both or neither", async () => {
    const t = await createApp();

    await t.addAccount("admin@example.com", "admin", { recoveryCodes: [] });

    const login = await t.send("POST", "/api/auth/login", {
      body: { email: "admin@example.com", password: PASSWORD },
    });
    const session = sessionOf(login);

    for (const body of [{}, { code: "123456", recoveryCode: "abcdef" }]) {
      const response = await t.send("POST", "/api/auth/mfa", { session, body });

      expect(response.statusCode).toBe(422);
    }

    const wrong = await t.send("POST", "/api/auth/mfa", {
      session,
      body: { recoveryCode: "nope" },
    });

    expect(wrong.statusCode).toBe(401);
  });

  it("answers the passkey routes as unavailable when the server package is missing", async () => {
    const t = await createApp();

    await t.addAccount("admin@example.com", "admin", { totpSecret: null, totpEnabledAt: null });

    const login = await t.send("POST", "/api/auth/login", {
      body: { email: "admin@example.com", password: PASSWORD },
    });
    const session = sessionOf(login);
    const options = await t.send("POST", "/api/auth/passkey/options", {
      session,
      body: { purpose: "register" },
    });
    const invalid = await t.send("POST", "/api/auth/passkey/options", {
      session,
      body: { purpose: "nope" },
    });
    const noResponse = await t.send("POST", "/api/auth/passkey/verify", {
      session,
      body: { purpose: "register" },
    });

    expect(login.json()).toMatchObject({ stage: "mfa-enrol" });
    expect(options.statusCode).toBe(501);
    expect(options.json()).toMatchObject({ code: "passkey.unavailable" });
    expect(invalid.statusCode).toBe(422);
    expect(noResponse.statusCode).toBe(422);
  });
});

describe("the session view", () => {
  it("is the signed-out view without a cookie", async () => {
    const t = await createApp();
    const response = await t.send("GET", "/api/auth/session");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "production",
      stage: "signed-out",
      account: null,
      role: null,
      csrf: null,
      expiresAt: null,
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("is the active view with the CSRF token for a signed-in session", async () => {
    const t = await createApp();
    const session = await t.signIn("viewer@example.com");
    const response = await t.send("GET", "/api/auth/session", { session });
    const view = response.json<{
      stage: string;
      role: string;
      csrf: string;
      account: { email: string };
    }>();

    expect(view).toMatchObject({
      stage: "active",
      role: "viewer",
      account: { email: "viewer@example.com" },
    });
    expect(view.csrf).toBe(session.csrf);
  });
});

describe("account routes", () => {
  async function adminAndViewer(t: TestApp) {
    return {
      admin: await t.signIn("admin@example.com", "admin"),
      viewer: await t.signIn("viewer@example.com"),
    };
  }

  it("shows the account, lists sessions and revokes another one", async () => {
    const t = await createApp();
    const first = await t.signIn("viewer@example.com");
    const second = await t.send("POST", "/api/auth/login", {
      body: { email: "viewer@example.com", password: PASSWORD },
    });
    const secondSession = sessionOf(second);

    expect((await t.send("GET", "/api/account", { session: first })).json()).toMatchObject({
      email: "viewer@example.com",
      role: "viewer",
    });

    const sessions = (await t.send("GET", "/api/account/sessions", { session: first })).json<
      { id: string; current: boolean }[]
    >();

    expect(sessions).toHaveLength(2);
    expect(sessions.filter((entry) => entry.current)).toHaveLength(1);

    const other = sessions.find((entry) => !entry.current);
    const revoked = await t.send("DELETE", `/api/account/sessions/${other?.id}`, {
      session: first,
    });

    expect(revoked.statusCode).toBe(204);
    expect((await t.send("GET", "/api/account", { session: secondSession })).statusCode).toBe(404);
  });

  it("changes the password only with the current one", async () => {
    const t = await createApp();
    const { viewer } = await adminAndViewer(t);
    const wrong = await t.send("POST", "/api/account/password", {
      session: viewer,
      body: { current: "wrong", password: "another long password" },
    });
    const right = await t.send("POST", "/api/account/password", {
      session: viewer,
      body: { current: PASSWORD, password: "another long password" },
    });

    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({ code: "auth.wrong-current-password" });
    expect(right.statusCode).toBe(200);
    expect(right.json()).toMatchObject({ stage: "active" });
  });

  it("refuses to remove the only second factor of an admin", async () => {
    const t = await createApp();
    const { admin } = await adminAndViewer(t);
    const response = await t.send("DELETE", "/api/account/totp", { session: admin });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "account.last-factor" });
  });

  it("regenerates recovery codes with a current code and answers them once", async () => {
    const t = await createApp();
    const admin = await t.signIn("admin@example.com", "admin");
    const wrong = await t.send("POST", "/api/account/recovery-codes", {
      session: admin,
      body: { code: "000000" },
    });

    expect(wrong.statusCode).toBe(401);

    // The sign-in used this time step's code; the next step's code is valid and unused.
    const response = await t.send("POST", "/api/account/recovery-codes", {
      session: admin,
      body: { code: totpCode(TOTP_SECRET, Date.now() + 30_000) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ codes: string[] }>().codes).toHaveLength(10);
  });

  it("starts an authenticator enrolment for a signed-in viewer", async () => {
    const t = await createApp();
    const viewer = await t.signIn("viewer@example.com");
    const start = await t.send("POST", "/api/account/totp/start", { session: viewer });

    expect(start.statusCode).toBe(200);
    expect(start.json()).toMatchObject({ secret: TOTP_SECRET });

    const confirm = await t.send("POST", "/api/account/totp/confirm", {
      session: viewer,
      body: { code: totpCode(TOTP_SECRET, Date.now()) },
    });

    expect(confirm.statusCode).toBe(200);
    expect(confirm.json<{ recoveryCodes: string[] }>().recoveryCodes).toHaveLength(10);
  });
});

describe("admin routes", () => {
  it("lists users, changes a role, resets a second factor, signs out and removes an account", async () => {
    const t = await createApp();
    const admin = await t.signIn("admin@example.com", "admin");
    const viewer = await t.signIn("viewer@example.com");

    const users = (await t.send("GET", "/api/admin/users", { session: admin })).json<{
      accounts: { id: string; email: string }[];
    }>();

    expect(users.accounts.map((account) => account.email).sort()).toEqual([
      "admin@example.com",
      "viewer@example.com",
    ]);

    const promoted = await t.send("PATCH", `/api/admin/users/${viewer.accountId}`, {
      session: admin,
      body: { role: "admin" },
    });

    expect(promoted.statusCode).toBe(200);
    expect(promoted.json()).toMatchObject({ id: viewer.accountId, role: "admin" });
    expect(
      (
        await t.send("PATCH", `/api/admin/users/${viewer.accountId}`, {
          session: admin,
          body: { role: "boss" },
        })
      ).statusCode,
    ).toBe(422);

    expect(
      (await t.send("POST", `/api/admin/users/${viewer.accountId}/reset-mfa`, { session: admin }))
        .statusCode,
    ).toBe(204);
    expect(
      (await t.send("POST", `/api/admin/users/${viewer.accountId}/sign-out`, { session: admin }))
        .statusCode,
    ).toBe(204);
    expect((await t.send("GET", "/api/panels", { session: viewer })).statusCode).toBe(404);
    expect(
      (await t.send("DELETE", `/api/admin/users/${viewer.accountId}`, { session: admin }))
        .statusCode,
    ).toBe(204);
  });

  it("will not let an admin remove or demote themselves", async () => {
    const t = await createApp();
    const admin = await t.signIn("admin@example.com", "admin");
    const removed = await t.send("DELETE", `/api/admin/users/${admin.accountId}`, {
      session: admin,
    });

    expect(removed.statusCode).toBe(409);
    expect(removed.json()).toMatchObject({
      code: expect.stringMatching(/^account\.(self|last-admin)$/),
    });
  });

  it("reads the audit log with filters and a bounded limit", async () => {
    const t = await createApp();
    const admin = await t.signIn("admin@example.com", "admin");

    await t.send("POST", "/api/auth/login", {
      body: { email: "x@example.com", password: "nope nope nope" },
    });

    const failed = await t.send("GET", "/api/admin/audit?type=login.failed", { session: admin });
    const limited = await t.send("GET", "/api/admin/audit?limit=1", { session: admin });
    const byAccount = await t.send("GET", `/api/admin/audit?account=${admin.accountId}`, {
      session: admin,
    });

    expect(failed.json<{ type: string }[]>().every((entry) => entry.type === "login.failed")).toBe(
      true,
    );
    expect(failed.json<unknown[]>()).toHaveLength(1);
    expect(limited.json<unknown[]>()).toHaveLength(1);
    expect(
      byAccount
        .json<{ accountId: string }[]>()
        .every((entry) => entry.accountId === admin.accountId),
    ).toBe(true);

    for (const query of ["limit=0", "limit=abc", "before=abc"]) {
      expect(
        (await t.send("GET", `/api/admin/audit?${query}`, { session: admin })).statusCode,
        query,
      ).toBe(422);
    }
  });
});

describe("the error handler", () => {
  it("answers an unexpected failure with a reference, logs the reason and hides it from the browser", async () => {
    const t = await createApp();
    const admin = await t.signIn("admin@example.com", "admin");

    t.auth.listUsers = vi.fn(async () => {
      throw new Error("password=hunter2 exploded");
    });

    const response = await t.send("GET", "/api/admin/users", { session: admin });
    const body = response.json<{ error: string; code: string; ref: string }>();

    expect(response.statusCode).toBe(500);
    expect(body.code).toBe("server.error");
    expect(body.ref).toMatch(/^[A-Z2-9]{8}$/);
    expect(body.error).toContain("Try again");
    expect(response.body).not.toContain("hunter2");
    expect(t.warnings.some((line) => line.includes(body.ref) && line.includes("exploded"))).toBe(
      true,
    );
    expect(response.headers["x-robots-tag"]).toBeDefined();
  });

  it("keeps an api error's status, message and code", async () => {
    const t = await createApp();
    const response = await t.send("POST", "/api/auth/invite/inspect", { body: { token: "x" } });

    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual({
      error:
        "This invite link is not valid, was already used, or has expired. Ask an admin for a new one.",
      code: "invite.invalid",
    });
  });
});
