import { describe, expect, it } from "vitest";
import { authOf, createWorld, FAKE_SECRET, meta, reload, type World } from "./harness";

const PASSWORD = "correct horse battery";

/** An admin signed in at the `mfa-enrol` stage. */
async function enrolling(world: World, email = "boss@example.com") {
  await world.addAccount(email, { role: "admin" });

  const step = await world.auth.login({ email, password: PASSWORD }, meta());

  expect(step.stage).toBe("mfa-enrol");

  return authOf(world, step);
}

/** An admin with an enrolled authenticator app, signed in and active. */
async function enrolled(world: World, email = "boss@example.com") {
  const auth = await enrolling(world, email);

  await world.auth.startTotp(auth, meta());

  const result = await world.auth.confirmTotp(await reload(world, auth), world.code(), meta());

  return { auth: await authOf(world, result.step), result };
}

describe("authenticator app", () => {
  it("starts enrolment with a secret, a key URI and the pending secret encrypted on the session", async () => {
    const world = createWorld();
    const auth = await enrolling(world);
    const enrolment = await world.auth.startTotp(auth, meta());

    expect(enrolment).toMatchObject({
      secret: FAKE_SECRET,
      issuer: "Warlock monitor",
      account: "boss@example.com",
    });
    expect(enrolment.uri).toContain(FAKE_SECRET);

    const session = (await reload(world, auth)).session;

    expect(session.pendingTotpSecret).toBe(`enc:${FAKE_SECRET}`);
  });

  it("refuses a wrong code and keeps the account without an app", async () => {
    const world = createWorld();
    const auth = await enrolling(world);

    await world.auth.startTotp(auth, meta());
    await expect(world.auth.confirmTotp(await reload(world, auth), "000000", meta())).rejects.toMatchObject({
      code: "auth.invalid-code",
    });
    expect((await reload(world, auth)).account.totpSecret).toBeNull();
    expect(await world.store.audit.list({ types: ["mfa.failed"], limit: 5 })).toHaveLength(1);
  });

  it("refuses confirming when enrolment was not started", async () => {
    const world = createWorld();
    const auth = await enrolling(world);

    await expect(world.auth.confirmTotp(auth, world.code(), meta())).rejects.toMatchObject({
      code: "input.invalid",
    });
  });

  it("confirms, stores the encrypted secret, issues ten recovery codes and goes active with a new token", async () => {
    const world = createWorld();
    const auth = await enrolling(world);

    await world.auth.startTotp(auth, meta());

    const { step, recoveryCodes } = await world.auth.confirmTotp(await reload(world, auth), world.code(), meta());

    expect(step.stage).toBe("active");
    expect(step.token).not.toBeNull();
    expect(await world.store.sessions.findByTokenHash(auth.session.tokenHash)).toBeNull();
    expect(recoveryCodes).toHaveLength(10);
    expect(recoveryCodes?.every((code) => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(code))).toBe(true);
    expect(new Set(recoveryCodes).size).toBe(10);

    const account = await world.store.accounts.findById(auth.account.id);

    expect(account?.totpSecret).toBe(`enc:${FAKE_SECRET}`);
    expect(account?.totpLastStep).toBe(Math.floor(world.now() / 30_000));
    expect(account?.recoveryCodes).toHaveLength(10);
    expect(JSON.stringify(account)).not.toContain(recoveryCodes?.[0] ?? "never");
    expect(account?.recoveryCodes.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
  });

  it("does not issue new recovery codes when the account has some", async () => {
    const world = createWorld();
    const { auth } = await enrolled(world);

    await world.auth.removeTotp(auth, meta(), PASSWORD).catch(() => undefined);

    // A passkey keeps the account compliant, so the app can be removed and re-added.
    const account = await world.store.accounts.findById(auth.account.id);

    await world.store.accounts.update(account!.id, account!.version, {
      passkeys: [{ id: "pk1", publicKey: "k", counter: 0, transports: [], name: "p", createdAt: 1, lastUsedAt: null }],
    });
    await world.auth.removeTotp(await reload(world, auth), meta(), PASSWORD);
    await world.auth.startTotp(await reload(world, auth), meta());

    world.advance(60_000);

    const result = await world.auth.confirmTotp(await reload(world, auth), world.code(), meta(), PASSWORD);

    expect(result.recoveryCodes).toBeNull();
  });

  it("refuses to start a second app while one is enrolled", async () => {
    const world = createWorld();
    const { auth } = await enrolled(world);

    await expect(world.auth.startTotp(auth, meta())).rejects.toMatchObject({ code: "input.invalid" });
  });

  describe("sign-in", () => {
    async function signedOutAdmin() {
      const world = createWorld();
      const { result } = await enrolled(world);

      return { world, recoveryCodes: result.recoveryCodes ?? [] };
    }

    async function verifying(world: World) {
      const step = await world.auth.login({ email: "boss@example.com", password: PASSWORD }, meta());

      expect(step.stage).toBe("mfa-verify");

      return authOf(world, step);
    }

    it("refuses a replayed code from the step used at enrolment", async () => {
      const { world } = await signedOutAdmin();
      const pending = await verifying(world);

      await expect(world.auth.verifySecondFactor(pending, { code: world.code() }, meta())).rejects.toMatchObject({
        code: "auth.invalid-code",
      });
    });

    it("refuses a code from an earlier step and accepts a later one", async () => {
      const { world } = await signedOutAdmin();
      const pending = await verifying(world);

      await expect(world.auth.verifySecondFactor(pending, { code: world.code(-1) }, meta())).rejects.toMatchObject({
        code: "auth.invalid-code",
      });

      const step = await world.auth.verifySecondFactor(pending, { code: world.code(1) }, meta());

      expect(step.stage).toBe("active");
    });

    it("refuses the same code twice, even from two sessions at once", async () => {
      const { world } = await signedOutAdmin();
      const a = await verifying(world);
      const b = await verifying(world);
      const code = world.code(1);
      const results = await Promise.allSettled([
        world.auth.verifySecondFactor(a, { code }, meta()),
        world.auth.verifySecondFactor(b, { code }, meta()),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    });

    it("refuses malformed codes and needs a code or a recovery code", async () => {
      const { world } = await signedOutAdmin();
      const pending = await verifying(world);

      for (const code of ["12345", "1234567", "abcdef", "12 34"]) {
        await expect(world.auth.verifySecondFactor(pending, { code }, meta())).rejects.toMatchObject({
          code: "auth.invalid-code",
        });
      }

      await expect(world.auth.verifySecondFactor(pending, {}, meta())).rejects.toMatchObject({
        code: "input.invalid",
      });
    });

    it("accepts a recovery code once, in any case and with or without the dash", async () => {
      const { world, recoveryCodes } = await signedOutAdmin();
      const first = recoveryCodes[0] ?? "";
      const step = await world.auth.verifySecondFactor(
        await verifying(world),
        { recoveryCode: first.toLowerCase().replace("-", " ") },
        meta(),
      );

      expect(step.stage).toBe("active");
      expect((await world.store.accounts.findByEmail("boss@example.com"))?.recoveryCodes).toHaveLength(9);
      expect(await world.store.audit.list({ types: ["recovery-code.used"], limit: 5 })).toHaveLength(1);

      await expect(
        world.auth.verifySecondFactor(await verifying(world), { recoveryCode: first }, meta()),
      ).rejects.toMatchObject({ code: "auth.invalid-code" });

      const second = await world.auth.verifySecondFactor(
        await verifying(world),
        { recoveryCode: recoveryCodes[1] ?? "" },
        meta(),
      );

      expect(second.stage).toBe("active");
    });

    it("lets one of two concurrent uses of a recovery code win", async () => {
      const { world, recoveryCodes } = await signedOutAdmin();
      const a = await verifying(world);
      const b = await verifying(world);
      const recoveryCode = recoveryCodes[2] ?? "";
      const results = await Promise.allSettled([
        world.auth.verifySecondFactor(a, { recoveryCode }, meta()),
        world.auth.verifySecondFactor(b, { recoveryCode }, meta()),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    });

    it("refuses a wrong recovery code and counts the failure", async () => {
      const { world } = await signedOutAdmin();

      await expect(
        world.auth.verifySecondFactor(await verifying(world), { recoveryCode: "AAAAA-AAAAA" }, meta()),
      ).rejects.toMatchObject({ code: "auth.invalid-code" });
      expect(await world.store.audit.list({ types: ["mfa.failed"], limit: 5 })).toHaveLength(1);
    });

    it("cannot be verified from a stage other than mfa-verify", async () => {
      const { world, } = await signedOutAdmin();
      const auth = await authOf(
        world,
        await world.auth.verifySecondFactor(await verifying(world), { code: world.code(1) }, meta()),
      );

      await expect(world.auth.verifySecondFactor(auth, { code: world.code(1) }, meta())).rejects.toMatchObject({
        code: "input.invalid",
      });
    });
  });

  describe("recovery codes", () => {
    it("regenerates with a fresh code and invalidates the old ones", async () => {
      const world = createWorld();
      const { auth, result } = await enrolled(world);
      const old = result.recoveryCodes ?? [];

      world.advance(60_000);

      const codes = await world.auth.regenerateRecoveryCodes(auth, world.code(), meta());

      expect(codes).toHaveLength(10);
      expect(codes.some((code) => old.includes(code))).toBe(false);
      expect((await world.store.accounts.findById(auth.account.id))?.recoveryCodes).toHaveLength(10);
      expect(await world.store.audit.list({ types: ["recovery-codes.regenerated"], limit: 5 })).toHaveLength(1);
    });

    it("needs a valid current code", async () => {
      const world = createWorld();
      const { auth, result } = await enrolled(world);

      await expect(world.auth.regenerateRecoveryCodes(auth, "000000", meta())).rejects.toMatchObject({
        code: "auth.invalid-code",
      });
      await expect(world.auth.regenerateRecoveryCodes(auth, "", meta())).rejects.toMatchObject({
        code: "auth.invalid-code",
      });
      expect((await world.store.accounts.findById(auth.account.id))?.recoveryCodes).toHaveLength(
        result.recoveryCodes?.length ?? 0,
      );
    });
  });

  describe("removal rules", () => {
    it("refuses to remove the only factor of an admin", async () => {
      const world = createWorld();
      const { auth } = await enrolled(world);

      await expect(world.auth.removeTotp(auth, meta())).rejects.toMatchObject({ code: "account.last-factor" });
    });

    it("lets a viewer remove the app when two-factor is only for admins", async () => {
      const world = createWorld();

      await world.addAccount("viewer@example.com", { totpSecret: `enc:${FAKE_SECRET}`, recoveryCodes: ["a"] });

      const pending = await authOf(world, await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta()));
      const auth = await authOf(world, await world.auth.verifySecondFactor(pending, { code: world.code() }, meta()));

      await world.auth.removeTotp(auth, meta(), PASSWORD);

      const account = await world.store.accounts.findById(auth.account.id);

      expect(account).toMatchObject({ totpSecret: null, recoveryCodes: [] });
      expect(await world.store.audit.list({ types: ["mfa.removed"], limit: 5 })).toHaveLength(1);
    });

    it("refuses to remove the app of anyone when two-factor is for everyone and it is the only factor", async () => {
      const world = createWorld({ options: { twoFactor: "everyone" } });

      await world.addAccount("viewer@example.com", { totpSecret: `enc:${FAKE_SECRET}` });

      const pending = await authOf(world, await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta()));
      const auth = await authOf(world, await world.auth.verifySecondFactor(pending, { code: world.code() }, meta()));

      await expect(world.auth.removeTotp(auth, meta())).rejects.toMatchObject({ code: "account.last-factor" });
    });
  });
});

describe("passkeys", () => {
  const credential = (id: string) => ({ id });

  it("throws passkey.unavailable for every passkey method when the library is missing", async () => {
    const world = createWorld();
    const auth = await enrolling(world);

    await expect(world.auth.passkeyOptions(auth, "register", meta())).rejects.toMatchObject({
      code: "passkey.unavailable",
    });
    await expect(world.auth.verifyPasskey(auth, "register", credential("a"), meta())).rejects.toMatchObject({
      code: "passkey.unavailable",
    });
  });

  it("registers a passkey as the first factor and goes active with recovery codes", async () => {
    const world = createWorld({ passkeys: true });
    const auth = await enrolling(world);

    await expect(world.auth.passkeyOptions(auth, "register", meta())).resolves.toEqual({ kind: "register" });
    expect((await reload(world, auth)).session.challenge).toBe("reg-challenge");

    const { step, recoveryCodes } = await world.auth.verifyPasskey(await reload(world, auth), "register", credential("cred-1"), meta());

    expect(step?.stage).toBe("active");
    expect(step?.token).not.toBeNull();
    expect(recoveryCodes).toHaveLength(10);

    const account = await world.store.accounts.findById(auth.account.id);

    expect(account?.passkeys[0]).toMatchObject({ id: "cred-1", publicKey: "pk", counter: 0 });
    expect(world.passkeys?.calls).toContain("verifyRegistration:reg-challenge");
  });

  it("uses the configured relying party, the origin host, or the request host", async () => {
    const seen: string[] = [];

    for (const options of [
      { passkeys: { rpName: "Warlock monitor", rpId: "configured.example" } },
      { origin: "https://origin.example:8443" },
      {},
    ]) {
      const world = createWorld({ passkeys: true, options });
      const auth = await enrolling(world);
      const adapter = world.passkeys!;
      const original = adapter.registrationOptions.bind(adapter);

      adapter.registrationOptions = async (input) => {
        seen.push(input.rpId);

        return original();
      };
      await world.auth.passkeyOptions(auth, "register", meta());
    }

    expect(seen).toEqual(["configured.example", "origin.example", "app.example.com"]);
  });

  it("consumes the challenge: a second answer is refused", async () => {
    const world = createWorld({ passkeys: true });
    const auth = await enrolling(world);

    await world.auth.passkeyOptions(auth, "register", meta());
    await world.auth.verifyPasskey(await reload(world, auth), "register", credential("cred-1"), meta());
    await expect(
      world.auth.verifyPasskey(await reload(world, auth).catch(() => auth), "register", credential("cred-2"), meta()),
    ).rejects.toMatchObject({ code: "passkey.failed" });
  });

  it("refuses an expired challenge and an answer with no challenge", async () => {
    const world = createWorld({ passkeys: true });
    const auth = await enrolling(world);

    await expect(world.auth.verifyPasskey(auth, "register", credential("a"), meta())).rejects.toMatchObject({
      code: "passkey.failed",
    });

    await world.auth.passkeyOptions(auth, "register", meta());
    world.advance(5 * 60_000 + 1);
    await expect(
      world.auth.verifyPasskey(await reload(world, auth), "register", credential("a"), meta()),
    ).rejects.toMatchObject({ code: "passkey.failed" });
  });

  it("refuses a registration the library rejects, and keeps the challenge spent", async () => {
    const world = createWorld({ passkeys: true });
    const auth = await enrolling(world);

    await world.auth.passkeyOptions(auth, "register", meta());
    world.passkeys!.failNext = true;
    await expect(
      world.auth.verifyPasskey(await reload(world, auth), "register", credential("a"), meta()),
    ).rejects.toMatchObject({ code: "passkey.failed" });
    expect((await reload(world, auth)).session.challenge).toBeNull();
  });

  describe("sign-in", () => {
    async function withPasskey(world: World) {
      await world.addAccount("boss@example.com", {
        role: "admin",
        recoveryCodes: ["h"],
        passkeys: [{ id: "cred-1", publicKey: "pk", counter: 3, transports: [], name: "Laptop", createdAt: 1, lastUsedAt: null }],
      });

      return authOf(world, await world.auth.login({ email: "boss@example.com", password: PASSWORD }, meta()));
    }

    it("verifies, advances the counter, and goes active with a new token", async () => {
      const world = createWorld({ passkeys: true });
      const pending = await withPasskey(world);

      expect(pending.stage).toBe("mfa-verify");

      await world.auth.passkeyOptions(pending, "login", meta());

      const { step } = await world.auth.verifyPasskey(await reload(world, pending), "login", credential("cred-1"), meta());

      expect(step?.stage).toBe("active");

      const account = await world.store.accounts.findByEmail("boss@example.com");

      expect(account?.passkeys[0]).toMatchObject({ counter: 7, lastUsedAt: world.now() });
      expect(await world.store.audit.list({ types: ["mfa.succeeded"], limit: 5 })).toHaveLength(1);
    });

    it("counts a failed assertion toward the limits", async () => {
      const world = createWorld({ passkeys: true });
      const pending = await withPasskey(world);

      await world.auth.passkeyOptions(pending, "login", meta());
      world.passkeys!.failNext = true;
      await expect(
        world.auth.verifyPasskey(await reload(world, pending), "login", credential("cred-1"), meta()),
      ).rejects.toMatchObject({ code: "passkey.failed" });
      expect(await world.store.audit.list({ types: ["mfa.failed"], limit: 5 })).toHaveLength(1);
    });

    it("lets an active session prove itself again to regenerate recovery codes without a TOTP code", async () => {
      const world = createWorld({ passkeys: true });
      const pending = await withPasskey(world);

      await world.auth.passkeyOptions(pending, "login", meta());

      const { step } = await world.auth.verifyPasskey(await reload(world, pending), "login", credential("cred-1"), meta());
      const active = await authOf(world, step!);

      await expect(world.auth.regenerateRecoveryCodes(active, "", meta())).rejects.toMatchObject({
        code: "auth.invalid-code",
      });

      await world.auth.passkeyOptions(active, "login", meta());
      await world.auth.verifyPasskey(await reload(world, active), "login", credential("cred-1"), meta());

      const codes = await world.auth.regenerateRecoveryCodes(await reload(world, active), "", meta());

      expect(codes).toHaveLength(10);

      // The marker is spent, and it expires after five minutes anyway.
      await expect(world.auth.regenerateRecoveryCodes(await reload(world, active), "", meta())).rejects.toMatchObject({
        code: "auth.invalid-code",
      });
    });
  });

  describe("removal", () => {
    it("refuses to remove the only factor of an admin and allows it when an app exists", async () => {
      const world = createWorld({ passkeys: true });

      await world.addAccount("boss@example.com", {
        role: "admin",
        passkeys: [{ id: "cred-1", publicKey: "pk", counter: 0, transports: [], name: "Laptop", createdAt: 1, lastUsedAt: null }],
      });

      const pending = await authOf(world, await world.auth.login({ email: "boss@example.com", password: PASSWORD }, meta()));

      await world.auth.passkeyOptions(pending, "login", meta());

      const { step } = await world.auth.verifyPasskey(await reload(world, pending), "login", credential("cred-1"), meta());
      const auth = await authOf(world, step!);

      await expect(world.auth.removePasskey(auth, "cred-1", meta())).rejects.toMatchObject({
        code: "account.last-factor",
      });
      await expect(world.auth.removePasskey(auth, "missing", meta())).rejects.toMatchObject({
        code: "account.not-found",
      });

      const account = await world.store.accounts.findById(auth.account.id);

      await world.store.accounts.update(account!.id, account!.version, { totpSecret: `enc:${FAKE_SECRET}` });
      await world.auth.removePasskey(await reload(world, auth), "cred-1", meta(), PASSWORD);

      expect((await world.store.accounts.findById(auth.account.id))?.passkeys).toEqual([]);
      expect(await world.store.audit.list({ types: ["passkey.removed"], limit: 5 })).toHaveLength(1);
    });
  });
});
