import { describe, expect, it } from "vitest";
import { createWorld, meta, signedIn, type World } from "./harness";

const DAY = 24 * 60 * 60_000;

async function adminWorld() {
  const world = createWorld();
  const admin = await signedIn(world, "boss@example.com", "admin");

  return { world, admin };
}

async function invite(
  world: World,
  admin: Awaited<ReturnType<typeof signedIn>>,
  email = "new@example.com",
  role: "admin" | "viewer" = "viewer",
) {
  return world.auth.createInvite(admin, { email, role }, meta());
}

describe("invites", () => {
  it("creates an invite for 24 hours and returns the token once", async () => {
    const { world, admin } = await adminWorld();
    const created = await invite(world, admin, "  New@Example.com ");

    expect(created.token).toMatch(/^[\w-]{43}$/);
    expect(created.invite).toMatchObject({
      email: "new@example.com",
      role: "viewer",
      expiresAt: world.now() + DAY,
      usedAt: null,
      createdBy: admin.account.id,
    });

    const stored = (await world.store.invites.list())[0];

    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect((await world.auth.listUsers(admin)).invites[0]).not.toHaveProperty("token");
    expect(await world.store.audit.list({ types: ["invite.created"], limit: 5 })).toHaveLength(1);
  });

  it("refuses an email that already has an account", async () => {
    const { world, admin } = await adminWorld();

    await expect(invite(world, admin, "BOSS@example.com")).rejects.toMatchObject({
      code: "invite.email-taken",
    });
  });

  it("refuses a bad email or role", async () => {
    const { world, admin } = await adminWorld();

    await expect(invite(world, admin, "not-an-email")).rejects.toMatchObject({
      code: "input.invalid",
    });
    await expect(invite(world, admin, "a@b.co", "root" as never)).rejects.toMatchObject({
      code: "input.invalid",
    });
  });

  it("inspects a valid invite, and answers invite.invalid for unknown, used and expired ones", async () => {
    const { world, admin } = await adminWorld();
    const created = await invite(world, admin);

    await expect(world.auth.inspectInvite(created.token)).resolves.toEqual({
      email: "new@example.com",
      role: "viewer",
    });

    for (const token of ["", "unknown", "x".repeat(500)]) {
      await expect(world.auth.inspectInvite(token)).rejects.toMatchObject({
        code: "invite.invalid",
        statusCode: 410,
      });
    }

    world.advance(DAY + 1);
    await expect(world.auth.inspectInvite(created.token)).rejects.toMatchObject({
      code: "invite.invalid",
    });
  });

  it("accepts an invite: creates the account, then signs in at the next stage", async () => {
    const { world, admin } = await adminWorld();
    const created = await invite(world, admin);
    const step = await world.auth.acceptInvite(
      { token: created.token, password: "My-Chosen-Passphrase-3" },
      meta(),
    );

    expect(step.stage).toBe("active");

    const account = await world.store.accounts.findByEmail("new@example.com");

    expect(account).toMatchObject({
      role: "viewer",
      passwordSource: "invite",
      passwordHash: "hash:My-Chosen-Passphrase-3",
      createdBy: admin.account.id,
      mustChangePassword: false,
    });
    expect(await world.store.audit.list({ types: ["invite.accepted"], limit: 5 })).toHaveLength(1);
  });

  it("sends an invited admin to enrol", async () => {
    const { world, admin } = await adminWorld();
    const created = await invite(world, admin, "second@example.com", "admin");
    const step = await world.auth.acceptInvite(
      { token: created.token, password: "My-Chosen-Passphrase-3" },
      meta(),
    );

    expect(step.stage).toBe("mfa-enrol");
  });

  it("applies the password rules, with the invited email as the forbidden password", async () => {
    const { world, admin } = await adminWorld();
    const created = await invite(world, admin);

    await expect(
      world.auth.acceptInvite({ token: created.token, password: "new@example.com" }, meta()),
    ).rejects.toMatchObject({
      code: "auth.password-same-as-email",
    });
    await expect(
      world.auth.acceptInvite({ token: created.token, password: "short" }, meta()),
    ).rejects.toMatchObject({
      code: "auth.password-too-short",
    });
    // A refused password does not spend the invite.
    await expect(world.auth.inspectInvite(created.token)).resolves.toBeDefined();
  });

  it("names the configured minimum length when the password is too short", async () => {
    const world = createWorld({ options: { passwords: { minLength: 12, rejectCommon: true } } });
    const admin = await signedIn(world, "boss@example.com", "admin");
    const created = await invite(world, admin);

    await expect(
      world.auth.acceptInvite({ token: created.token, password: "elevenchars" }, meta()),
    ).rejects.toMatchObject({
      code: "auth.password-too-short",
      message: "Use a password of at least 12 characters.",
    });
  });

  it("cannot be used twice", async () => {
    const { world, admin } = await adminWorld();
    const created = await invite(world, admin);

    await world.auth.acceptInvite(
      { token: created.token, password: "My-Chosen-Passphrase-3" },
      meta(),
    );
    await expect(
      world.auth.acceptInvite(
        { token: created.token, password: "Another-Chosen-Passphrase-4" },
        meta(),
      ),
    ).rejects.toMatchObject({ code: "invite.invalid" });
    await expect(world.auth.inspectInvite(created.token)).rejects.toMatchObject({
      code: "invite.invalid",
    });
  });

  it("lets one of two concurrent accepts win; the loser gets invite.invalid", async () => {
    const { world, admin } = await adminWorld();
    const created = await invite(world, admin);
    const results = await Promise.allSettled([
      world.auth.acceptInvite(
        { token: created.token, password: "First-Chosen-Passphrase-3" },
        meta(),
      ),
      world.auth.acceptInvite(
        { token: created.token, password: "Second-Chosen-Passphrase-4" },
        meta(),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const loser = results.find((result) => result.status === "rejected");

    expect(loser).toMatchObject({ reason: { code: "invite.invalid" } });
    expect(
      (await world.store.accounts.list()).filter((account) => account.email === "new@example.com"),
    ).toHaveLength(1);
  });

  it("cannot be accepted after expiry or revocation", async () => {
    const { world, admin } = await adminWorld();
    const expired = await invite(world, admin);
    const revoked = await invite(world, admin, "other@example.com");

    await world.auth.revokeInvite(admin, revoked.invite.id, meta());
    await expect(
      world.auth.acceptInvite({ token: revoked.token, password: "My-Chosen-Passphrase-3" }, meta()),
    ).rejects.toMatchObject({ code: "invite.invalid" });

    world.advance(DAY + 1);
    await expect(
      world.auth.acceptInvite({ token: expired.token, password: "My-Chosen-Passphrase-3" }, meta()),
    ).rejects.toMatchObject({ code: "invite.invalid" });
    expect(await world.store.audit.list({ types: ["invite.revoked"], limit: 5 })).toHaveLength(1);
  });

  it("revoking an unknown invite answers invite.invalid", async () => {
    const { world, admin } = await adminWorld();

    await expect(world.auth.revokeInvite(admin, "nope", meta())).rejects.toMatchObject({
      code: "invite.invalid",
    });
  });

  it("is admin-only", async () => {
    const world = createWorld();
    const viewer = await signedIn(world, "viewer@example.com");

    await expect(
      world.auth.createInvite(viewer, { email: "a@b.co", role: "viewer" }, meta()),
    ).rejects.toMatchObject({
      code: "role.forbidden",
    });
    await expect(world.auth.revokeInvite(viewer, "x", meta())).rejects.toMatchObject({
      code: "role.forbidden",
    });
  });
});
