import { describe, expect, it } from "vitest";
import { authOf, createWorld, FAKE_SECRET, meta, reload, type World } from "./harness";

const PASSWORD = "correct horse battery";
const LAPTOP = {
  id: "cred-1",
  publicKey: "pk",
  counter: 3,
  transports: [],
  name: "Laptop",
  createdAt: 1,
  lastUsedAt: null,
};

/** A viewer with an authenticator app, a passkey and recovery codes, signed in and active. */
async function signedInWithFactors(world: World) {
  await world.addAccount("viewer@example.com", {
    totpSecret: `enc:${FAKE_SECRET}`,
    passkeys: [LAPTOP],
    recoveryCodes: ["h"],
  });

  const pending = await authOf(
    world,
    await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta()),
  );

  return authOf(world, await world.auth.verifySecondFactor(pending, { code: world.code() }, meta()));
}

/** Passes a passkey check in the active session (the step-up). */
async function stepUp(world: World, auth: Awaited<ReturnType<typeof signedInWithFactors>>) {
  await world.auth.passkeyOptions(await reload(world, auth), "login", meta());
  await world.auth.verifyPasskey(await reload(world, auth), "login", { id: "cred-1" }, meta());

  return reload(world, auth);
}

describe("changing second factors from an active session", () => {
  it("removing the authenticator app needs the current password", async () => {
    const world = createWorld({ passkeys: true });
    const auth = await signedInWithFactors(world);

    await expect(world.auth.removeTotp(auth, meta())).rejects.toMatchObject({
      code: "auth.wrong-current-password",
    });
    await expect(world.auth.removeTotp(auth, meta(), "not the password")).rejects.toMatchObject({
      code: "auth.wrong-current-password",
    });
    expect((await world.store.accounts.findById(auth.account.id))?.totpSecret).not.toBeNull();
    // A wrong password counts toward the sign-in limits.
    expect(await world.store.audit.count({ types: ["login.failed"], since: 0 })).toBe(2);

    await world.auth.removeTotp(await reload(world, auth), meta(), PASSWORD);

    expect((await world.store.accounts.findById(auth.account.id))?.totpSecret).toBeNull();
  });

  it("removing a passkey needs the current password", async () => {
    const world = createWorld({ passkeys: true });
    const auth = await signedInWithFactors(world);

    await expect(world.auth.removePasskey(auth, "cred-1", meta())).rejects.toMatchObject({
      code: "auth.wrong-current-password",
    });
    expect((await world.store.accounts.findById(auth.account.id))?.passkeys).toHaveLength(1);

    await world.auth.removePasskey(await reload(world, auth), "cred-1", meta(), PASSWORD);

    expect((await world.store.accounts.findById(auth.account.id))?.passkeys).toHaveLength(0);
  });

  it("a fresh passkey step-up stands in for the password once", async () => {
    const world = createWorld({ passkeys: true });
    const auth = await stepUp(world, await signedInWithFactors(world));

    await world.auth.removeTotp(auth, meta());

    const account = await world.store.accounts.findById(auth.account.id);

    expect(account?.totpSecret).toBeNull();

    // Spent: the next change asks again.
    await world.store.accounts.update(account!.id, account!.version, {
      passkeys: [LAPTOP, { ...LAPTOP, id: "cred-2" }],
    });
    await expect(
      world.auth.removePasskey(await reload(world, auth), "cred-2", meta()),
    ).rejects.toMatchObject({ code: "auth.wrong-current-password" });
  });

  it("adding an authenticator app needs the current password", async () => {
    const world = createWorld({ passkeys: true });

    await world.addAccount("viewer@example.com", { passkeys: [LAPTOP], recoveryCodes: ["h"] });

    const pending = await authOf(
      world,
      await world.auth.login({ email: "viewer@example.com", password: PASSWORD }, meta()),
    );

    await world.auth.passkeyOptions(pending, "login", meta());

    const { step } = await world.auth.verifyPasskey(await reload(world, pending), "login", { id: "cred-1" }, meta());
    const auth = await authOf(world, step!);

    await world.auth.startTotp(auth, meta());
    await expect(
      world.auth.confirmTotp(await reload(world, auth), world.code(), meta()),
    ).rejects.toMatchObject({ code: "auth.wrong-current-password" });
    expect((await world.store.accounts.findById(auth.account.id))?.totpSecret).toBeNull();

    await world.auth.confirmTotp(await reload(world, auth), world.code(), meta(), PASSWORD);

    expect((await world.store.accounts.findById(auth.account.id))?.totpSecret).not.toBeNull();
  });

  it("registering a passkey needs the current password, but not while enrolling at sign-in", async () => {
    const world = createWorld({ passkeys: true });
    const auth = await signedInWithFactors(world);

    await world.auth.passkeyOptions(auth, "register", meta());
    await expect(
      world.auth.verifyPasskey(await reload(world, auth), "register", { id: "cred-9" }, meta()),
    ).rejects.toMatchObject({ code: "auth.wrong-current-password" });

    await world.auth.passkeyOptions(await reload(world, auth), "register", meta());
    await world.auth.verifyPasskey(await reload(world, auth), "register", { id: "cred-9" }, meta(), PASSWORD);

    expect((await world.store.accounts.findById(auth.account.id))?.passkeys).toHaveLength(2);

    // The first factor at sign-in follows the password, so it is not asked again.
    await world.addAccount("boss@example.com", { role: "admin" });

    const enrolling = await authOf(
      world,
      await world.auth.login({ email: "boss@example.com", password: PASSWORD }, meta()),
    );

    expect(enrolling.stage).toBe("mfa-enrol");

    await world.auth.passkeyOptions(enrolling, "register", meta());

    const result = await world.auth.verifyPasskey(await reload(world, enrolling), "register", { id: "cred-boss" }, meta());

    expect(result.step?.stage).toBe("active");
  });
});

describe("the step-up for recovery codes", () => {
  it("is single use when two requests race on it", async () => {
    const world = createWorld({ passkeys: true });
    const auth = await stepUp(world, await signedInWithFactors(world));

    // Both requests read the same session before either writes.
    const results = await Promise.allSettled([
      world.auth.regenerateRecoveryCodes(auth, "", meta()),
      world.auth.regenerateRecoveryCodes(auth, "", meta()),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "auth.invalid-code" },
    });
    expect(await world.store.audit.list({ types: ["recovery-codes.regenerated"], limit: 5 })).toHaveLength(1);
  });
});
