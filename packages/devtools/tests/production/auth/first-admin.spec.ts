import { describe, expect, it } from "vitest";
import { DevtoolsApiError, DevtoolsProductionConfigError } from "../../../src/production/errors";
import { createWorld, meta } from "./harness";

const admin = (patch: Record<string, string | null>) => ({
  email: "owner@example.com",
  password: null,
  setupToken: null,
  ...patch,
});

describe("ensureFirstAdmin", () => {
  it("refuses to start with no admin and no env admin (DT003)", async () => {
    const world = createWorld();

    await expect(world.auth.ensureFirstAdmin()).rejects.toMatchObject({ code: "DT003" });
  });

  it("refuses an email without a password or token (DT003)", async () => {
    const world = createWorld({ options: { admin: admin({}) } });

    await expect(world.auth.ensureFirstAdmin()).rejects.toBeInstanceOf(DevtoolsProductionConfigError);
  });

  it("accepts a missing env admin when an admin already exists", async () => {
    const world = createWorld();

    await world.addAccount("someone@example.com", { role: "admin" });
    await expect(world.auth.ensureFirstAdmin()).resolves.toBeUndefined();
  });

  it("refuses a weak env password (DT004)", async () => {
    for (const password of ["short", "password123", "owner@example.com", "x".repeat(73)]) {
      const world = createWorld({ options: { admin: admin({ password }) } });

      await expect(world.auth.ensureFirstAdmin()).rejects.toMatchObject({ code: "DT004" });
      expect(await world.store.accounts.countAdmins()).toBe(0);
    }
  });

  it("seeds the admin from the env password and forces a change", async () => {
    const world = createWorld({ options: { admin: admin({ password: "Tr0ub4dor&3-horse" }) } });

    await world.auth.ensureFirstAdmin();

    const account = await world.store.accounts.findByEmail("owner@example.com");

    expect(account).toMatchObject({
      role: "admin",
      passwordSource: "env",
      mustChangePassword: true,
      passwordHash: "hash:Tr0ub4dor&3-horse",
    });

    const types = (await world.store.audit.list({ limit: 10 })).map((entry) => entry.type);

    expect(types).toContain("admin.seeded");
  });

  it("lower-cases and trims the env email", async () => {
    const world = createWorld({
      options: { admin: admin({ email: "  Owner@Example.COM ", password: "Tr0ub4dor&3-horse" }) },
    });

    await world.auth.ensureFirstAdmin();

    expect(await world.store.accounts.findByEmail("owner@example.com")).not.toBeNull();
  });

  it("is safe to run twice (two instances booting)", async () => {
    const world = createWorld({ options: { admin: admin({ password: "Tr0ub4dor&3-horse" }) } });

    await world.auth.ensureFirstAdmin();
    await world.auth.ensureFirstAdmin();

    expect((await world.store.accounts.list()).length).toBe(1);
  });

  it("replaces the stored hash when the env password changes while its source is env", async () => {
    const world = createWorld({ options: { admin: admin({ password: "Tr0ub4dor&3-horse" }) } });

    await world.auth.ensureFirstAdmin();
    world.options.admin.password = "Another-Strong-One-9";
    await world.auth.ensureFirstAdmin();

    const account = await world.store.accounts.findByEmail("owner@example.com");

    expect(account?.passwordHash).toBe("hash:Another-Strong-One-9");
    expect(account?.mustChangePassword).toBe(true);
  });

  it("refuses a weak replacement env password (DT004)", async () => {
    const world = createWorld({ options: { admin: admin({ password: "Tr0ub4dor&3-horse" }) } });

    await world.auth.ensureFirstAdmin();
    world.options.admin.password = "password123";

    await expect(world.auth.ensureFirstAdmin()).rejects.toMatchObject({ code: "DT004" });
  });

  it("ignores the env password once the admin changed it", async () => {
    const world = createWorld({ options: { admin: admin({ password: "Tr0ub4dor&3-horse" }) } });

    await world.auth.ensureFirstAdmin();

    const step = await world.auth.login(
      { email: "owner@example.com", password: "Tr0ub4dor&3-horse" },
      meta(),
    );

    expect(step.stage).toBe("password-change");

    const auth = await world.auth.authenticate(step.token ?? "");

    await world.auth.changePassword(auth!, { password: "My-New-Passphrase-1" }, meta());

    world.options.admin.password = "Env-Changed-Later-77";
    await world.auth.ensureFirstAdmin();

    const account = await world.store.accounts.findByEmail("owner@example.com");

    expect(account?.passwordHash).toBe("hash:My-New-Passphrase-1");
    expect(account?.passwordSource).toBe("user");
  });

  describe("setup token", () => {
    const token = "s".repeat(40);

    it("seeds an admin whose placeholder hash never verifies", async () => {
      const world = createWorld({ options: { admin: admin({ setupToken: token }) } });

      await world.auth.ensureFirstAdmin();

      const account = await world.store.accounts.findByEmail("owner@example.com");

      expect(account?.passwordSource).toBe("setup");
      expect(account?.passwordHash.startsWith("!")).toBe(true);

      await expect(
        world.auth.login({ email: "owner@example.com", password: account?.passwordHash ?? "" }, meta()),
      ).rejects.toMatchObject({ code: "auth.invalid-credentials" });
    });

    it("lets the admin choose a password once, with the token", async () => {
      const world = createWorld({ options: { admin: admin({ setupToken: token }) } });

      await world.auth.ensureFirstAdmin();

      const step = await world.auth.setup({ token, password: "A-Long-Chosen-Password-5" }, meta());

      expect(step.stage).toBe("mfa-enrol");
      expect(step.token).not.toBeNull();

      const account = await world.store.accounts.findByEmail("owner@example.com");

      expect(account).toMatchObject({
        passwordSource: "user",
        passwordHash: "hash:A-Long-Chosen-Password-5",
        mustChangePassword: false,
      });

      await expect(
        world.auth.setup({ token, password: "Second-Attempt-Password-6" }, meta()),
      ).rejects.toMatchObject({ code: "auth.invalid-setup-token" });
    });

    it("refuses a wrong token and counts it as a failure", async () => {
      const world = createWorld({ options: { admin: admin({ setupToken: token }) } });

      await world.auth.ensureFirstAdmin();

      await expect(
        world.auth.setup({ token: "w".repeat(40), password: "A-Long-Chosen-Password-5" }, meta()),
      ).rejects.toBeInstanceOf(DevtoolsApiError);

      expect(
        await world.store.audit.count({ types: ["login.failed"], since: 0, ip: "203.0.113.5" }),
      ).toBe(1);
      expect((await world.store.accounts.findByEmail("owner@example.com"))?.passwordSource).toBe(
        "setup",
      );
    });

    it("applies the password rules after the token matched", async () => {
      const world = createWorld({ options: { admin: admin({ setupToken: token }) } });

      await world.auth.ensureFirstAdmin();

      await expect(world.auth.setup({ token, password: "short" }, meta())).rejects.toMatchObject({
        code: "auth.password-too-short",
      });
      expect((await world.store.accounts.findByEmail("owner@example.com"))?.passwordSource).toBe(
        "setup",
      );
    });

    it("refuses the token once the admin is not in the setup state", async () => {
      const world = createWorld({ options: { admin: admin({ setupToken: token }) } });

      await world.addAccount("owner@example.com", { role: "admin" });

      await expect(
        world.auth.setup({ token, password: "A-Long-Chosen-Password-5" }, meta()),
      ).rejects.toMatchObject({ code: "auth.invalid-setup-token" });
    });

    it("refuses any token when none is configured", async () => {
      const world = createWorld();

      await expect(
        world.auth.setup({ token: "", password: "A-Long-Chosen-Password-5" }, meta()),
      ).rejects.toMatchObject({ code: "auth.invalid-setup-token" });
    });

    it("lets only one of two concurrent setups win", async () => {
      const world = createWorld({ options: { admin: admin({ setupToken: token }) } });

      await world.auth.ensureFirstAdmin();

      const results = await Promise.allSettled([
        world.auth.setup({ token, password: "First-Concurrent-Password-1" }, meta()),
        world.auth.setup({ token, password: "Second-Concurrent-Password-2" }, meta()),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    });
  });
});
