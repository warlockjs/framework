import { describe, expect, it } from "vitest";
import { authOf, createWorld, FAKE_SECRET, meta } from "./harness";

const PASSWORD = "correct horse battery";

describe("login", () => {
  it("signs a viewer in straight to an active session", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com");

    const step = await world.auth.login(
      { email: "  Viewer@Example.com ", password: PASSWORD },
      meta(),
    );

    expect(step.stage).toBe("active");
    expect(step.token).toMatch(/^[\w-]{43}$/);
    expect(step.csrf).toBeTruthy();

    const account = await world.store.accounts.findByEmail("viewer@example.com");

    expect(account?.lastLoginAt).toBe(world.now());
    expect(account?.failuresResetAt).toBe(world.now());
  });

  it("stores only the hash of the token", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com");

    const step = await world.auth.login(
      { email: "viewer@example.com", password: PASSWORD },
      meta(),
    );
    const sessions = await world.store.sessions.listForAccount(step.session.accountId);

    expect(JSON.stringify(sessions)).not.toContain(step.token ?? "never");
    expect(sessions[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com");

    const unknown = await world.auth
      .login({ email: "nobody@example.com", password: PASSWORD }, meta())
      .catch((error) => error);
    const wrong = await world.auth
      .login({ email: "viewer@example.com", password: "not the password" }, meta())
      .catch((error) => error);

    expect(unknown.code).toBe("auth.invalid-credentials");
    expect(wrong.code).toBe("auth.invalid-credentials");
    expect(unknown.message).toBe(wrong.message);
    expect(unknown.statusCode).toBe(wrong.statusCode);
  });

  it("audits failures without the password", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com");
    await world.auth
      .login({ email: "viewer@example.com", password: "secret-guess-1" }, meta())
      .catch(() => undefined);
    await world.auth
      .login({ email: "nobody@example.com", password: "secret-guess-2" }, meta())
      .catch(() => undefined);

    const entries = await world.store.audit.list({ limit: 10 });

    expect(entries.map((entry) => entry.type)).toEqual(["login.failed", "login.failed"]);
    expect(JSON.stringify(entries)).not.toContain("secret-guess");
    expect(entries.every((entry) => /^[A-Z2-9]{8}$/.test(entry.ref))).toBe(true);
  });

  it("puts a forced password change first", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com", {
      mustChangePassword: true,
      passwordSource: "env",
    });

    const step = await world.auth.login(
      { email: "viewer@example.com", password: PASSWORD },
      meta(),
    );

    expect(step.stage).toBe("password-change");
    expect(step.session.expiresAt).toBe(world.now() + 10 * 60_000);
  });

  it("asks an admin without a factor to enrol", async () => {
    const world = createWorld();

    await world.addAccount("boss@example.com", { role: "admin" });

    expect(
      (await world.auth.login({ email: "boss@example.com", password: PASSWORD }, meta())).stage,
    ).toBe("mfa-enrol");
  });

  it("asks every account to enrol when twoFactor is everyone", async () => {
    const world = createWorld({ options: { twoFactor: "everyone" } });

    await world.addAccount("viewer@example.com");

    expect(
      (await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta())).stage,
    ).toBe("mfa-enrol");
  });

  it("skips enrolment for every role when twoFactor is off", async () => {
    const world = createWorld({ options: { twoFactor: "off" } });

    await world.addAccount("boss@example.com", { role: "admin" });
    await world.addAccount("viewer@example.com");

    for (const email of ["boss@example.com", "viewer@example.com"]) {
      expect((await world.auth.login({ email, password: PASSWORD }, meta())).stage).toBe("active");
    }
  });

  it("still asks for a factor an account has when twoFactor is off", async () => {
    const world = createWorld({ options: { twoFactor: "off" } });

    await world.addAccount("boss@example.com", { role: "admin", totpSecret: `enc:${FAKE_SECRET}` });

    expect(
      (await world.auth.login({ email: "boss@example.com", password: PASSWORD }, meta())).stage,
    ).toBe("mfa-verify");
  });

  it("asks an account with a factor to verify", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com", { totpSecret: `enc:${FAKE_SECRET}` });

    expect(
      (await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta())).stage,
    ).toBe("mfa-verify");
  });

  it("reaches active with a new token after the second factor", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com", { totpSecret: `enc:${FAKE_SECRET}` });

    const first = await world.auth.login(
      { email: "viewer@example.com", password: PASSWORD },
      meta(),
    );
    const pending = await authOf(world, first);
    const second = await world.auth.verifySecondFactor(pending, { code: world.code() }, meta());

    expect(second.stage).toBe("active");
    expect(second.token).not.toBe(first.token);
    expect(await world.auth.authenticate(first.token ?? "")).toBeNull();
    expect((await world.auth.authenticate(second.token ?? ""))?.stage).toBe("active");
  });

  it("refuses an empty or non-string input the same way", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com");

    for (const input of [
      { email: "", password: "" },
      { email: "viewer@example.com", password: "" },
      { email: 5, password: {} },
    ]) {
      await expect(world.auth.login(input as never, meta())).rejects.toMatchObject({
        code: "auth.invalid-credentials",
      });
    }
  });

  it("cuts a very long password before checking it", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com");
    await world.auth
      .login({ email: "viewer@example.com", password: "x".repeat(100_000) }, meta())
      .catch(() => undefined);

    expect(
      Math.max(...world.crypto.verifyCalls.map((call) => call.password.length)),
    ).toBeLessThanOrEqual(1024);
  });

  it("truncates the user agent in sessions and audit entries", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com");
    await world.auth
      .login(
        { email: "viewer@example.com", password: "wrong password" },
        { ...meta(), userAgent: "u".repeat(500) },
      )
      .catch(() => undefined);

    const [entry] = await world.store.audit.list({ limit: 1 });

    expect(entry?.userAgent).toHaveLength(200);
  });
});
