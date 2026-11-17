import { describe, expect, it } from "vitest";
import { authOf, createWorld, meta, MINUTE, signedIn } from "./harness";

const PASSWORD = "correct horse battery";

async function login(world: ReturnType<typeof createWorld>, email = "viewer@example.com") {
  await world.addAccount(email);

  return world.auth.login({ email, password: PASSWORD }, meta());
}

describe("sessions", () => {
  it("authenticates a cookie token and returns the account", async () => {
    const world = createWorld();
    const step = await login(world);
    const auth = await world.auth.authenticate(step.token ?? "");

    expect(auth?.account.email).toBe("viewer@example.com");
    expect(auth?.stage).toBe("active");
  });

  it("rejects missing, empty, unknown and oversized tokens", async () => {
    const world = createWorld();

    await login(world);

    for (const token of [undefined, "", "unknown", "x".repeat(500)]) {
      expect(await world.auth.authenticate(token)).toBeNull();
    }
  });

  it("expires an active session after maxHours and deletes it", async () => {
    const world = createWorld();
    const step = await login(world);

    // Busy enough never to idle out: 19 visits 25 minutes apart is 7 h 55 min.
    for (let visit = 0; visit < 19; visit++) {
      world.advance(25 * MINUTE);
      expect(await world.auth.authenticate(step.token ?? "")).not.toBeNull();
    }

    world.advance(25 * MINUTE);

    expect(await world.auth.authenticate(step.token ?? "")).toBeNull();
    expect(await world.store.sessions.findByTokenHash(step.session.tokenHash)).toBeNull();
  });

  it("expires after the idle time", async () => {
    const world = createWorld();
    const step = await login(world);

    world.advance(30 * MINUTE + 1);

    expect(await world.auth.authenticate(step.token ?? "")).toBeNull();
    expect(await world.store.sessions.findByTokenHash(step.session.tokenHash)).toBeNull();
  });

  it("expires a pending session after pendingMinutes even when used", async () => {
    const world = createWorld();

    await world.addAccount("boss@example.com", { role: "admin" });

    const step = await world.auth.login({ email: "boss@example.com", password: PASSWORD }, meta());

    expect(step.stage).toBe("mfa-enrol");

    world.advance(9 * MINUTE);
    expect(await world.auth.authenticate(step.token ?? "")).not.toBeNull();
    world.advance(2 * MINUTE);
    expect(await world.auth.authenticate(step.token ?? "")).toBeNull();
  });

  it("drops the session of a removed account", async () => {
    const world = createWorld();
    const step = await login(world);

    await world.store.accounts.remove(step.session.accountId);

    expect(await world.auth.authenticate(step.token ?? "")).toBeNull();
    expect(await world.store.sessions.findByTokenHash(step.session.tokenHash)).toBeNull();
  });

  it("touches lastSeenAt at most once a minute", async () => {
    const world = createWorld();
    const step = await login(world);
    const start = world.now();

    world.advance(30_000);
    await world.auth.authenticate(step.token ?? "");
    expect((await world.store.sessions.findByTokenHash(step.session.tokenHash))?.lastSeenAt).toBe(start);

    world.advance(30_000);
    await world.auth.authenticate(step.token ?? "");
    expect((await world.store.sessions.findByTokenHash(step.session.tokenHash))?.lastSeenAt).toBe(world.now());

    const version = (await world.store.sessions.findByTokenHash(step.session.tokenHash))?.version;

    world.advance(10_000);
    await world.auth.authenticate(step.token ?? "");
    expect((await world.store.sessions.findByTokenHash(step.session.tokenHash))?.version).toBe(version);
  });

  it("ignores a lost touch race", async () => {
    const world = createWorld();
    const step = await login(world);

    world.advance(2 * MINUTE);

    const results = await Promise.all([
      world.auth.authenticate(step.token ?? ""),
      world.auth.authenticate(step.token ?? ""),
    ]);

    expect(results.every((auth) => auth !== null)).toBe(true);
  });

  it("mints a new token when the session becomes active and removes the old one", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com", { mustChangePassword: true, passwordSource: "env" });

    const first = await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta());
    const pending = await authOf(world, first);
    const second = await world.auth.changePassword(pending, { password: "A-fresh-passphrase-42" }, meta());

    expect(second.stage).toBe("active");
    expect(second.token).not.toBe(first.token);
    expect(second.session.id).not.toBe(first.session.id);
    expect(await world.auth.authenticate(first.token ?? "")).toBeNull();
    expect(await world.auth.authenticate(second.token ?? "")).not.toBeNull();
  });

  it("gives an active session maxHours of life and a pending one pendingMinutes", async () => {
    const world = createWorld();
    const active = await login(world);

    expect(active.session.expiresAt).toBe(world.now() + 8 * 60 * MINUTE);

    await world.addAccount("boss@example.com", { role: "admin" });

    const pending = await world.auth.login({ email: "boss@example.com", password: PASSWORD }, meta());

    expect(pending.session.expiresAt).toBe(world.now() + 10 * MINUTE);
  });

  it("logout removes the session and audits it", async () => {
    const world = createWorld();
    const step = await login(world);
    const auth = await authOf(world, step);

    await world.auth.logout(auth, meta());

    expect(await world.auth.authenticate(step.token ?? "")).toBeNull();
    expect(await world.store.audit.list({ types: ["logout"], limit: 5 })).toHaveLength(1);
  });

  it("lists own sessions, marks the current one, and revokes another", async () => {
    const world = createWorld();
    const first = await login(world);

    world.advance(1000);

    const second = await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta("198.51.100.9"));
    const auth = await authOf(world, second);
    const list = await world.auth.listSessions(auth);

    expect(list).toHaveLength(2);
    expect(list.find((item) => item.current)?.id).toBe(second.session.id);

    await world.auth.revokeSession(auth, first.session.id, meta());

    expect(await world.auth.authenticate(first.token ?? "")).toBeNull();
  });

  it("cannot revoke another account's session", async () => {
    const world = createWorld();
    const mine = await login(world);
    const other = await login(world, "other@example.com");
    const auth = await authOf(world, mine);

    await expect(world.auth.revokeSession(auth, other.session.id, meta())).rejects.toMatchObject({
      code: "account.not-found",
    });
    expect(await world.auth.authenticate(other.token ?? "")).not.toBeNull();
  });

  describe("csrf", () => {
    it("is the same on every call and every tab of the session", async () => {
      const world = createWorld();
      const step = await login(world);
      const auth = await authOf(world, step);

      world.advance(2 * MINUTE);

      // A second tab: the same cookie, a later (touched) copy of the session.
      const again = await authOf(world, step);

      expect(again.session.version).not.toBe(auth.session.version);
      expect(world.auth.csrfToken(auth.session)).toBe(world.auth.csrfToken(again.session));
      expect(world.auth.sessionView(auth).csrf).toBe(world.auth.csrfToken(auth.session));
    });

    it("differs between sessions", async () => {
      const world = createWorld();
      const a = await authOf(world, await login(world));
      const b = await authOf(world, await login(world, "two@example.com"));

      expect(world.auth.csrfToken(a.session)).not.toBe(world.auth.csrfToken(b.session));
    });

    it("verifies only the exact token", async () => {
      const world = createWorld();
      const auth = await authOf(world, await login(world));
      const token = world.auth.csrfToken(auth.session);

      expect(world.auth.verifyCsrf(auth, token)).toBe(true);
      expect(world.auth.verifyCsrf(auth, undefined)).toBe(false);
      expect(world.auth.verifyCsrf(auth, "")).toBe(false);
      expect(world.auth.verifyCsrf(auth, token.slice(0, -1))).toBe(false);
      expect(world.auth.verifyCsrf(auth, `${token}x`)).toBe(false);
      expect(world.auth.verifyCsrf(auth, token.replace(/^./, token.startsWith("A") ? "B" : "A"))).toBe(false);
    });

    it("compares with the constant-time helper, never with ===", async () => {
      const { readFile } = await import("node:fs/promises");
      const source = await readFile(new URL("../../../src/production/auth/service.ts", import.meta.url), "utf8");

      expect(source).toContain("safeEqual(header, csrfToken(auth.session))");
      expect(source).not.toMatch(/header\s*===\s*csrfToken|csrfToken\([^)]*\)\s*===\s*header/);
    });

    it("is not derived from the session token or the csrf secret alone", async () => {
      const world = createWorld();
      const auth = await authOf(world, await login(world));
      const token = world.auth.csrfToken(auth.session);

      expect(token).not.toContain(auth.session.csrfSecret);
      expect(Buffer.from(token, "base64url").toString()).not.toContain(auth.session.csrfSecret);
    });
  });

  describe("session view", () => {
    it("signed out", () => {
      const world = createWorld();

      expect(world.auth.sessionView(null)).toMatchObject({
        mode: "production",
        stage: "signed-out",
        account: null,
        csrf: null,
        methods: null,
      });
    });

    it("signed in, without secrets", async () => {
      const world = createWorld({ passkeys: true });
      const auth = await authOf(world, await login(world));
      const view = world.auth.sessionView(auth);

      expect(view).toMatchObject({
        stage: "active",
        role: "viewer",
        methods: { totp: true, passkeys: true },
        expiresAt: auth.session.expiresAt,
      });
      expect(JSON.stringify(view)).not.toMatch(/passwordHash|totpSecret|recoveryCodes"|csrfSecret/);
    });

    it("reports passkeys off when the library is missing", async () => {
      const world = createWorld();
      const auth = await signedIn(world, "viewer@example.com");

      expect(world.auth.sessionView(auth).methods).toEqual({ totp: true, passkeys: false });
    });
  });

  it("changing the password ends the account's other sessions", async () => {
    const world = createWorld();
    const first = await login(world);
    const second = await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta("198.51.100.9"));
    const auth = await authOf(world, second);

    await world.auth.changePassword(auth, { current: PASSWORD, password: "Brand-new-passphrase-8" }, meta());

    expect(await world.auth.authenticate(first.token ?? "")).toBeNull();
    expect(await world.auth.authenticate(second.token ?? "")).not.toBeNull();
  });
});
