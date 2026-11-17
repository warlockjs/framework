import { describe, expect, it } from "vitest";
import { authOf, createWorld, FAKE_SECRET, meta } from "./harness";

const PASSWORD = "correct horse battery";

describe("the account limit on second-factor guesses", () => {
  it("is not reset by signing in with the password again", async () => {
    const world = createWorld();
    const email = "viewer@example.com";

    await world.addAccount(email, { totpSecret: `enc:${FAKE_SECRET}` });

    // Someone who knows the password guesses codes, signing in again before the
    // account limit (5) is reached. Every try comes from a new address, so only
    // the account limit can stop it.
    let ip = 0;

    for (let round = 0; round < 4; round++) {
      const step = await world.auth
        .login({ email, password: PASSWORD }, meta(`198.51.100.${ip++}`))
        .catch(() => null);

      if (step === null) break;

      const pending = await authOf(world, step);

      for (let guess = 0; guess < 4; guess++) {
        await world.auth
          .verifySecondFactor(pending, { code: "000000" }, meta(`198.51.100.${ip++}`))
          .catch(() => undefined);
        world.advance(1000);
      }
    }

    const guesses = await world.store.audit.count({ types: ["mfa.failed"], since: 0 });

    expect(guesses).toBeLessThanOrEqual(5);
  });

  it("is reset once the account is fully signed in", async () => {
    const world = createWorld();
    const email = "viewer@example.com";

    await world.addAccount(email, { totpSecret: `enc:${FAKE_SECRET}` });

    const step = await world.auth.login({ email, password: PASSWORD }, meta());
    const pending = await authOf(world, step);

    for (let guess = 0; guess < 4; guess++) {
      await world.auth
        .verifySecondFactor(pending, { code: "000000" }, meta(`198.51.100.${guess}`))
        .catch(() => undefined);
    }

    world.advance(30_000);

    const active = await world.auth.verifySecondFactor(pending, { code: world.code() }, meta());

    expect(active.stage).toBe("active");

    // The earlier failures no longer count: four more wrong passwords leave the account open.
    for (let index = 0; index < 4; index++) {
      await world.auth
        .login({ email, password: "wrong password" }, meta(`198.51.100.${50 + index}`))
        .catch(() => undefined);
    }

    expect(
      (await world.auth.login({ email, password: PASSWORD }, meta("198.51.100.99"))).stage,
    ).toBe("mfa-verify");
  });
});

describe("refused tries", () => {
  it("cannot grow the audit log without bound", async () => {
    const world = createWorld();

    await world.addAccount("viewer@example.com");

    // Over the IP limit (20), every further try is refused before the password is checked.
    for (let index = 0; index < 20; index++) {
      await world.auth
        .login({ email: "viewer@example.com", password: "wrong password" }, meta())
        .catch(() => undefined);
      world.advance(10);
    }

    for (let index = 0; index < 200; index++) {
      await expect(
        world.auth.login({ email: "viewer@example.com", password: "wrong password" }, meta()),
      ).rejects.toMatchObject({ code: "auth.invalid-credentials" });
      world.advance(10);
    }

    const blocked = () => world.store.audit.count({ types: ["login.blocked"], since: 0 });

    expect(await blocked()).toBe(1);

    // One entry a minute per address and account keeps the trail.
    world.advance(60_000);
    await world.auth
      .login({ email: "viewer@example.com", password: "wrong password" }, meta())
      .catch(() => undefined);

    expect(await blocked()).toBe(2);
  });

  it("cost no password check once the address is over its limit", async () => {
    const world = createWorld();

    // Twenty unknown emails from one address put it over the IP limit.
    for (let index = 0; index < 20; index++) {
      await world.auth
        .login({ email: `ghost${index}@example.com`, password: "wrong password" }, meta())
        .catch(() => undefined);
    }

    world.crypto.verifyCalls.length = 0;

    for (let index = 0; index < 10; index++) {
      await expect(
        world.auth.login({ email: "ghost@example.com", password: "wrong password" }, meta()),
      ).rejects.toMatchObject({ code: "auth.invalid-credentials" });
    }

    // A blocked address is no lever on the app's CPU, and cannot hold the verification slots.
    expect(world.crypto.verifyCalls).toHaveLength(0);
  });
});
