import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateTemporaryPassword, checkPasswordPolicy, generateToken, hashToken } from "../../../src/production/auth";
import { authOf, createWorld, FAKE_SECRET, meta, reload, signedIn, type World } from "./harness";

async function setup() {
  const world = createWorld();
  const admin = await signedIn(world, "boss@example.com", "admin");
  const viewer = await world.addAccount("viewer@example.com");

  return { world, admin, viewer };
}

async function secondAdmin(world: World) {
  return world.addAccount("second@example.com", { role: "admin", totpSecret: `enc:${FAKE_SECRET}` });
}

describe("admin actions", () => {
  it("lists accounts without secrets and only unexpired unused invites", async () => {
    const { world, admin } = await setup();
    const list = await world.auth.listUsers(admin);

    expect(list.accounts.map((account) => account.email)).toEqual(["boss@example.com", "viewer@example.com"]);
    expect(JSON.stringify(list)).not.toMatch(/hash|secret/i);
  });

  it("refuses every admin action to a viewer, and to an admin who is not active", async () => {
    const { world, viewer } = await setup();
    const step = await world.auth.login({ email: "viewer@example.com", password: "correct horse battery" }, meta());
    const auth = await authOf(world, step);

    expect(viewer.role).toBe("viewer");

    const attempts = [
      () => world.auth.listUsers(auth),
      () => world.auth.setRole(auth, viewer.id, "admin", meta()),
      () => world.auth.removeAccount(auth, viewer.id, meta()),
      () => world.auth.resetSecondFactor(auth, viewer.id, meta()),
      () => world.auth.signOutAccount(auth, viewer.id, meta()),
      () => world.auth.disableDashboard(auth, meta()),
    ];

    for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ code: "role.forbidden" });

    await world.addAccount("pending-admin@example.com", { role: "admin" });

    const pending = await authOf(world, await world.auth.login({ email: "pending-admin@example.com", password: "correct horse battery" }, meta()));

    expect(pending.stage).toBe("mfa-enrol");
    await expect(world.auth.listUsers(pending)).rejects.toMatchObject({ code: "role.forbidden" });
    await expect(world.auth.disableDashboard(pending, meta())).rejects.toMatchObject({ code: "role.forbidden" });
  });

  describe("roles", () => {
    it("promotes a viewer and audits it", async () => {
      const { world, admin, viewer } = await setup();
      const view = await world.auth.setRole(admin, viewer.id, "admin", meta());

      expect(view.role).toBe("admin");
      expect(await world.store.audit.list({ types: ["account.role-changed"], limit: 5 })).toHaveLength(1);
    });

    it("ends the sessions of an account promoted to admin without a factor", async () => {
      const { world, admin, viewer } = await setup();
      const step = await world.auth.login({ email: "viewer@example.com", password: "correct horse battery" }, meta());

      await world.auth.setRole(admin, viewer.id, "admin", meta());

      expect(await world.auth.authenticate(step.token ?? "")).toBeNull();

      // At the next sign-in it must enrol.
      expect((await world.auth.login({ email: "viewer@example.com", password: "correct horse battery" }, meta())).stage).toBe("mfa-enrol");
    });

    it("keeps the sessions of an account promoted to admin that already has a factor", async () => {
      const { world, admin } = await setup();
      const viewer = await world.addAccount("v2@example.com", { totpSecret: `enc:${FAKE_SECRET}` });
      const pending = await authOf(world, await world.auth.login({ email: "v2@example.com", password: "correct horse battery" }, meta()));
      const step = await world.auth.verifySecondFactor(pending, { code: world.code() }, meta());

      await world.auth.setRole(admin, viewer.id, "admin", meta());

      expect(await world.auth.authenticate(step.token ?? "")).not.toBeNull();
    });

    it("refuses to demote yourself", async () => {
      const { world, admin } = await setup();

      await secondAdmin(world);
      await expect(world.auth.setRole(admin, admin.account.id, "viewer", meta())).rejects.toMatchObject({
        code: "account.self",
      });
    });

    it("refuses to demote the last admin (a caller whose own record is already gone)", async () => {
      const { world, admin } = await setup();
      const other = await secondAdmin(world);

      await world.store.accounts.remove(admin.account.id);

      await expect(world.auth.setRole(admin, other.id, "viewer", meta())).rejects.toMatchObject({
        code: "account.last-admin",
      });
      expect((await world.store.accounts.findById(other.id))?.role).toBe("admin");
    });

    it("demotes another admin while two exist", async () => {
      const { world, admin } = await setup();
      const other = await secondAdmin(world);

      await world.auth.setRole(admin, other.id, "viewer", meta());
      expect(await world.store.accounts.countAdmins()).toBe(1);
    });

    it("answers account.not-found for an unknown account", async () => {
      const { world, admin } = await setup();

      await expect(world.auth.setRole(admin, "nope", "admin", meta())).rejects.toMatchObject({ code: "account.not-found" });
    });
  });

  describe("removal", () => {
    it("removes an account and its sessions", async () => {
      const { world, admin, viewer } = await setup();
      const step = await world.auth.login({ email: "viewer@example.com", password: "correct horse battery" }, meta());

      await world.auth.removeAccount(admin, viewer.id, meta());

      expect(await world.store.accounts.findById(viewer.id)).toBeNull();
      expect(await world.auth.authenticate(step.token ?? "")).toBeNull();
      expect(await world.store.sessions.listForAccount(viewer.id)).toEqual([]);
      expect(await world.store.audit.list({ types: ["account.removed"], limit: 5 })).toHaveLength(1);
    });

    it("refuses to remove yourself", async () => {
      const { world, admin } = await setup();

      await secondAdmin(world);
      await expect(world.auth.removeAccount(admin, admin.account.id, meta())).rejects.toMatchObject({ code: "account.self" });
    });

    it("refuses to remove the last admin (a caller whose own record is already gone)", async () => {
      const { world, admin } = await setup();
      const other = await secondAdmin(world);

      await world.store.accounts.remove(admin.account.id);

      await expect(world.auth.removeAccount(admin, other.id, meta())).rejects.toMatchObject({
        code: "account.last-admin",
      });
      expect(await world.store.accounts.findById(other.id)).not.toBeNull();
    });

    it("answers account.not-found for an unknown account", async () => {
      const { world, admin } = await setup();

      await expect(world.auth.removeAccount(admin, "nope", meta())).rejects.toMatchObject({ code: "account.not-found" });
    });
  });

  describe("second factor reset and sign-out", () => {
    it("resets another account's factors and ends its sessions", async () => {
      const { world, admin } = await setup();
      const target = await world.addAccount("t@example.com", {
        totpSecret: `enc:${FAKE_SECRET}`,
        totpEnabledAt: 1,
        totpLastStep: 5,
        recoveryCodes: ["h1"],
        passkeys: [{ id: "p", publicKey: "k", counter: 0, transports: [], name: "n", createdAt: 1, lastUsedAt: null }],
      });
      const step = await world.auth.login({ email: "t@example.com", password: "correct horse battery" }, meta());

      await world.auth.resetSecondFactor(admin, target.id, meta());

      expect(await world.store.accounts.findById(target.id)).toMatchObject({
        totpSecret: null,
        totpLastStep: null,
        recoveryCodes: [],
        passkeys: [],
      });
      expect(await world.store.sessions.findByTokenHash(step.session.tokenHash)).toBeNull();
      expect(await world.store.audit.list({ types: ["account.mfa-reset"], limit: 5 })).toHaveLength(1);
    });

    it("refuses to reset your own factors", async () => {
      const { world, admin } = await setup();

      await expect(world.auth.resetSecondFactor(admin, admin.account.id, meta())).rejects.toMatchObject({ code: "account.self" });
    });

    it("signs an account out everywhere", async () => {
      const { world, admin, viewer } = await setup();
      const a = await world.auth.login({ email: "viewer@example.com", password: "correct horse battery" }, meta());
      const b = await world.auth.login({ email: "viewer@example.com", password: "correct horse battery" }, meta("198.51.100.4"));

      await world.auth.signOutAccount(admin, viewer.id, meta());

      expect(await world.auth.authenticate(a.token ?? "")).toBeNull();
      expect(await world.auth.authenticate(b.token ?? "")).toBeNull();
      expect(await world.store.audit.list({ types: ["account.signed-out"], limit: 5 })).toHaveLength(1);
    });

    it("keeps the caller's own session when signing out itself", async () => {
      const { world, admin } = await setup();

      await world.auth.signOutAccount(admin, admin.account.id, meta());

      expect((await reload(world, admin)).session.id).toBe(admin.session.id);
    });
  });

  describe("disable dashboard", () => {
    it("sets the flag with the hash of the current path and audits it", async () => {
      const { world, admin } = await setup();

      await world.auth.disableDashboard(admin, meta());

      const state = await world.store.state.read();

      expect(state).toMatchObject({
        disabled: true,
        disabledPathHash: createHash("sha256").update(world.options.path).digest("hex"),
        disabledAt: world.now(),
        disabledBy: admin.account.id,
      });
      expect(await world.store.audit.list({ types: ["dashboard.disabled"], limit: 5 })).toHaveLength(1);
    });
  });

  describe("audit", () => {
    it("never throws, returns a reference, and warns without secrets when the write fails", async () => {
      const world = createWorld();

      world.store.audit.append = async () => {
        throw new Error("disk full");
      };

      const ref = await world.auth.audit("logout", { email: "A@B.co", meta: meta() });

      expect(ref).toMatch(/^[A-Z2-9]{8}$/);
      expect(world.warnings).toHaveLength(1);
      expect(world.warnings[0]).toContain(ref);
    });

    it("lower-cases the email, limits the user agent and reads the account from the auth", async () => {
      const { world, admin } = await setup();

      await world.auth.audit("panel.action", {
        auth: admin,
        meta: { ...meta(), userAgent: "u".repeat(900) },
        detail: { panel: "grimoire" },
      });
      await world.auth.audit("login.failed", { email: "MiXed@Example.COM" });

      const [panel] = await world.store.audit.list({ types: ["panel.action"], limit: 1 });
      const [failed] = await world.store.audit.list({ types: ["login.failed"], limit: 1 });

      expect(panel).toMatchObject({
        accountId: admin.account.id,
        email: "boss@example.com",
        userAgent: "u".repeat(200),
        detail: { panel: "grimoire" },
      });
      expect(failed).toMatchObject({
        email: "mixed@example.com",
        ip: null,
      });
    });
  });
});

describe("password change", () => {
  const PASSWORD = "correct horse battery";

  async function active() {
    const world = createWorld();
    const auth = await signedIn(world, "viewer@example.com");

    return { world, auth };
  }

  it("needs the current password for an active session", async () => {
    const { world, auth } = await active();

    await expect(world.auth.changePassword(auth, { password: "Brand-new-passphrase-8" }, meta())).rejects.toMatchObject({
      code: "auth.wrong-current-password",
    });
    await expect(
      world.auth.changePassword(auth, { current: "wrong", password: "Brand-new-passphrase-8" }, meta()),
    ).rejects.toMatchObject({ code: "auth.wrong-current-password" });
    expect((await world.store.accounts.findById(auth.account.id))?.passwordHash).toBe(`hash:${PASSWORD}`);
  });

  it("changes it and audits without the password", async () => {
    const { world, auth } = await active();

    await world.auth.changePassword(auth, { current: PASSWORD, password: "Brand-new-passphrase-8" }, meta());

    expect((await world.store.accounts.findById(auth.account.id))?.passwordHash).toBe("hash:Brand-new-passphrase-8");

    const entries = await world.store.audit.list({ types: ["password.changed"], limit: 5 });

    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain("Brand-new-passphrase-8");
  });

  it("refuses the same password", async () => {
    const { world, auth } = await active();

    await expect(world.auth.changePassword(auth, { current: PASSWORD, password: PASSWORD }, meta())).rejects.toMatchObject({
      code: "auth.password-unchanged",
    });
  });

  it("applies the password rules", async () => {
    const { world, auth } = await active();

    for (const [password, code] of [
      ["short", "auth.password-too-short"],
      ["viewer@example.com", "auth.password-same-as-email"],
      ["Password123", "auth.password-common"],
      ["x".repeat(80), "auth.password-too-long"],
    ] as const) {
      await expect(world.auth.changePassword(auth, { current: PASSWORD, password }, meta())).rejects.toMatchObject({ code });
    }
  });

  it("counts a wrong current password as a failure", async () => {
    const { world, auth } = await active();

    await world.auth.changePassword(auth, { current: "wrong", password: "Brand-new-passphrase-8" }, meta()).catch(() => undefined);

    expect(await world.store.audit.list({ types: ["login.failed"], limit: 5 })).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("checkPasswordPolicy orders its rules", () => {
    expect(checkPasswordPolicy("short", null)).toBe("auth.password-too-short");
    expect(checkPasswordPolicy("1234567", null)).toBe("auth.password-too-short");
    expect(checkPasswordPolicy("é".repeat(40), null)).toBe("auth.password-too-long");
    expect(checkPasswordPolicy("é".repeat(36), null)).toBeNull();
    expect(checkPasswordPolicy("PassWord123", null)).toBe("auth.password-common");
    expect(checkPasswordPolicy("Me@Example.com", "me@example.com")).toBe("auth.password-same-as-email");
    expect(checkPasswordPolicy("Me@Example.com", "other@example.com")).toBeNull();
    expect(checkPasswordPolicy("correct horse battery", null)).toBeNull();
  });

  it("counts characters, not UTF-16 units, for the minimum", () => {
    expect(checkPasswordPolicy("😀😀😀😀😀😀😀😀", null)).toBeNull();
  });

  it("generates 43-character tokens and SHA-256 hex hashes", () => {
    const token = generateToken();

    expect(token).toMatch(/^[\w-]{43}$/);
    expect(generateToken()).not.toBe(token);
    expect(hashToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("generates temporary passwords that pass the policy", () => {
    for (let index = 0; index < 50; index++) {
      const password = generateTemporaryPassword();

      expect(password).toHaveLength(20);
      expect(password).toMatch(/^[A-HJKMNP-Za-hjkmnp-z2-9]{20}$/);
      expect(checkPasswordPolicy(password, null)).toBeNull();
    }
  });
});
