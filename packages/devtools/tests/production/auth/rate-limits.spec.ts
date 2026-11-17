import { describe, expect, it, vi } from "vitest";
import { createWorld, meta, MINUTE } from "./harness";

const PASSWORD = "correct horse battery";

async function fail(world: ReturnType<typeof createWorld>, email: string, ip = "203.0.113.5") {
  return world.auth.login({ email, password: "wrong password" }, meta(ip)).catch((error) => error);
}

describe("rate limits", () => {
  it("blocks an account after five failures, even with the right password", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com");

    // Different IPs, so only the account limit applies.
    for (let index = 0; index < 5; index++) await fail(world, "viewer@example.com", `198.51.100.${index}`);

    const blocked = await world.auth
      .login({ email: "viewer@example.com", password: PASSWORD }, meta("198.51.100.99"))
      .catch((error) => error);

    expect(blocked.code).toBe("auth.invalid-credentials");

    expect(await world.store.audit.list({ types: ["login.blocked"], limit: 5 })).toHaveLength(1);
  });

  it("blocked tries do not extend the block", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com");

    for (let index = 0; index < 5; index++) await fail(world, "viewer@example.com", `198.51.100.${index}`);
    for (let index = 0; index < 10; index++) await fail(world, "viewer@example.com", "198.51.100.200");

    expect(
      await world.store.audit.count({ types: ["login.failed"], since: 0, accountId: (await world.store.accounts.findByEmail("viewer@example.com"))?.id ?? "" }),
    ).toBe(5);
  });

  it("slides the window: failures older than 15 minutes stop counting", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com");

    for (let index = 0; index < 5; index++) await fail(world, "viewer@example.com", `198.51.100.${index}`);

    world.advance(15 * MINUTE + 1);

    const step = await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta("198.51.100.99"));

    expect(step.stage).toBe("active");
  });

  it("blocks an IP after twenty failures across accounts and unknown emails", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com");

    for (let index = 0; index < 20; index++) await fail(world, `ghost${index}@example.com`);

    const blocked = await world.auth
      .login({ email: "viewer@example.com", password: PASSWORD }, meta())
      .catch((error) => error);

    expect(blocked.code).toBe("auth.invalid-credentials");

    // Another IP still signs in.
    expect(
      (await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta("198.51.100.7"))).stage,
    ).toBe("active");
  });

  it("locks the whole dashboard at the global limit and audits it once", async () => {
    const world = createWorld({ options: { rateLimits: { windowMinutes: 15, account: 50, ip: 50, global: 6, lockMinutes: 15 } } });

    for (let index = 0; index < 6; index++) await fail(world, `ghost${index}@example.com`, `198.51.100.${index}`);

    const state = await world.store.state.read();

    expect(state.lockedUntil).toBe(world.now() + 15 * MINUTE);

    await fail(world, "ghost9@example.com", "198.51.100.40");

    const locks = await world.store.audit.list({ types: ["dashboard.locked"], limit: 10 });

    expect(locks).toHaveLength(1);
  });

  it("refuses everyone while locked and opens after the lock ends", async () => {
    const world = createWorld({ options: { rateLimits: { windowMinutes: 15, account: 50, ip: 50, global: 3, lockMinutes: 5 } } });

    await world.addAccount("viewer@example.com");

    for (let index = 0; index < 3; index++) await fail(world, `ghost${index}@example.com`, `198.51.100.${index}`);

    await expect(
      world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta("198.51.100.77")),
    ).rejects.toMatchObject({ code: "auth.invalid-credentials" });

    world.advance(15 * MINUTE + 1);

    expect(
      (await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta("198.51.100.77"))).stage,
    ).toBe("active");
  });

  it("failuresResetAt on the account (CLI) reopens a blocked account", async () => {
    const world = createWorld();
    const account = await world.addAccount("viewer@example.com");

    for (let index = 0; index < 5; index++) await fail(world, "viewer@example.com", `198.51.100.${index}`);

    world.advance(1000);
    await world.store.accounts.update(account.id, account.version, { failuresResetAt: world.now() });
    world.advance(1000);

    expect(
      (await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta("198.51.100.99"))).stage,
    ).toBe("active");
  });

  it("failuresResetAt on the state (CLI) reopens the IP and the lock", async () => {
    const world = createWorld({ options: { rateLimits: { windowMinutes: 15, account: 50, ip: 3, global: 4, lockMinutes: 15 } } });

    await world.addAccount("viewer@example.com");

    for (let index = 0; index < 3; index++) await fail(world, `ghost${index}@example.com`);

    await fail(world, "ghost9@example.com", "198.51.100.9");

    expect((await world.store.state.read()).lockedUntil).not.toBeNull();

    world.advance(1000);

    const state = await world.store.state.read();

    await world.store.state.update(state.version, { lockedUntil: null, failuresResetAt: world.now() });
    world.advance(1000);

    expect((await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta())).stage).toBe("active");
  });

  it("counts failed second factors toward the limits", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com", { totpSecret: "enc:JBSWY3DPEHPK3PXP" });

    const step = await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta());
    const pending = await world.auth.authenticate(step.token ?? "");

    for (let index = 0; index < 4; index++) {
      await expect(
        world.auth.verifySecondFactor(pending!, { code: "000000" }, meta("198.51.100.1")),
      ).rejects.toMatchObject({ code: "auth.invalid-code" });
    }

    // The success at login reset the account count, so four failures are on file; one more makes five.
    await expect(
      world.auth.verifySecondFactor(pending!, { code: "000000" }, meta("198.51.100.2")),
    ).rejects.toMatchObject({ code: "auth.invalid-code" });

    await expect(
      world.auth.verifySecondFactor(pending!, { code: world.code() }, meta("198.51.100.3")),
    ).rejects.toMatchObject({ code: "auth.invalid-code" });

    expect((await world.store.audit.list({ types: ["login.blocked"], limit: 5 })).length).toBe(1);
  });

  describe("equal timing", () => {
    it("runs one password verification for an unknown email", async () => {
      const world = createWorld();

      await fail(world, "ghost@example.com");

      expect(world.crypto.verifyCalls).toHaveLength(1);
    });

    it("runs one verification against the dummy hash, not the account hash, for a blocked account", async () => {
      const world = createWorld();

      await world.addAccount("viewer@example.com");

      for (let index = 0; index < 5; index++) await fail(world, "viewer@example.com", `198.51.100.${index}`);

      world.crypto.verifyCalls.length = 0;

      await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta("198.51.100.99")).catch(() => undefined);

      expect(world.crypto.verifyCalls).toHaveLength(1);
      expect(world.crypto.verifyCalls[0]?.hash).not.toBe(`hash:${PASSWORD}`);
      expect(world.crypto.verifyCalls[0]?.hash.startsWith("hash:devtools-timing-")).toBe(true);
    });

    it("verifies against the real hash for a known, unblocked account", async () => {
      const world = createWorld();

      await world.addAccount("viewer@example.com");
      await fail(world, "viewer@example.com");

      expect(world.crypto.verifyCalls[0]?.hash).toBe(`hash:${PASSWORD}`);
    });

    it("verifies once for a setup-pending admin (placeholder hash)", async () => {
      const world = createWorld();

      await world.addAccount("owner@example.com", { role: "admin", passwordHash: "!no-password-set", passwordSource: "setup" });
      await fail(world, "owner@example.com");

      expect(world.crypto.verifyCalls).toHaveLength(1);
      expect(world.crypto.verifyCalls[0]?.hash).not.toBe("!no-password-set");
    });
  });

  describe("busy cap", () => {
    it("answers auth.busy beyond four verifications in flight, and recovers", async () => {
      const world = createWorld();

      await world.addAccount("viewer@example.com");

      const release = world.crypto.holdVerifications();
      const pending = Array.from({ length: 4 }, (_, index) =>
        world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta(`198.51.100.${index}`)),
      );

      await vi.waitFor(() => expect(world.crypto.verifyCalls).toHaveLength(4));

      const fifth = await world.auth
        .login({ email: "viewer@example.com", password: PASSWORD }, meta("198.51.100.50"))
        .catch((error) => error);

      expect(fifth.code).toBe("auth.busy");
      expect(fifth.statusCode).toBe(503);

      release();
      await Promise.all(pending);

      expect(
        (await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta("198.51.100.51"))).stage,
      ).toBe("active");
    });
  });
});
