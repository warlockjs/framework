import { describe, expect, it } from "vitest";
import { createApp, PASSWORD, tokenOf, type TestApp } from "./harness";

async function invite(t: TestApp, role: "admin" | "viewer" = "viewer", email = "new@example.com") {
  const admin = await t.signIn("admin@example.com", "admin");
  const response = await t.send("POST", "/api/admin/invites", {
    session: admin,
    body: { email, role },
  });

  return {
    admin,
    response,
    created: response.json<{
      token: string;
      invite: { id: string; email: string; role: string };
    }>(),
  };
}

describe("invite routes", () => {
  it("lets an admin create an invite that shows the link token once", async () => {
    const t = await createApp();
    const { admin, response, created } = await invite(t);

    expect(response.statusCode).toBe(200);
    expect(created.token).toHaveLength(43);
    expect(created.invite).toMatchObject({ email: "new@example.com", role: "viewer" });

    const list = await t.send("GET", "/api/admin/users", { session: admin });

    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain(created.token);
    expect(list.json<{ invites: unknown[] }>().invites).toHaveLength(1);
  });

  it("inspects a valid invite without a session and reveals only the email and role", async () => {
    const t = await createApp({ notFound: "custom" });
    const { created } = await invite(t);
    const response = await t.send("POST", "/api/auth/invite/inspect", {
      body: { token: created.token },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ email: "new@example.com", role: "viewer" });
  });

  it("answers invite.invalid for an unknown token and for a malformed body", async () => {
    const t = await createApp();
    const unknown = await t.send("POST", "/api/auth/invite/inspect", { body: { token: "nope" } });
    const empty = await t.send("POST", "/api/auth/invite/inspect", { body: {} });

    expect(unknown.statusCode).toBe(410);
    expect(unknown.json()).toMatchObject({ code: "invite.invalid" });
    expect(empty.statusCode).toBe(422);
    expect(empty.json()).toMatchObject({ code: "input.invalid" });
  });

  it("accepts an invite once: it sets a session cookie, and a second try fails", async () => {
    const t = await createApp();
    const { created } = await invite(t);
    const accepted = await t.send("POST", "/api/auth/invite/accept", {
      body: { token: created.token, password: PASSWORD },
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ stage: "active" });
    expect(tokenOf(accepted)).toBeDefined();

    const again = await t.send("POST", "/api/auth/invite/accept", {
      body: { token: created.token, password: PASSWORD },
    });

    expect(again.statusCode).toBe(410);
    expect(again.json()).toMatchObject({ code: "invite.invalid" });
  });

  it("signs the new viewer in with the cookie it was given", async () => {
    const t = await createApp();
    const { created } = await invite(t);
    const accepted = await t.send("POST", "/api/auth/invite/accept", {
      body: { token: created.token, password: PASSWORD },
    });
    const session = {
      token: tokenOf(accepted) ?? "",
      csrf: accepted.json<{ csrf: string }>().csrf,
      accountId: "",
    };
    const view = await t.send("GET", "/api/auth/session", { session });

    expect(view.json()).toMatchObject({
      stage: "active",
      role: "viewer",
      account: { email: "new@example.com" },
    });
    expect((await t.send("GET", "/api/panels", { session })).statusCode).toBe(200);
    expect((await t.send("GET", "/api/admin/users", { session })).statusCode).toBe(403);
  });

  it("sends an invited admin to enrol a second factor before anything else", async () => {
    const t = await createApp({ notFound: "custom" });
    const { created } = await invite(t, "admin", "boss@example.com");
    const accepted = await t.send("POST", "/api/auth/invite/accept", {
      body: { token: created.token, password: PASSWORD },
    });
    const session = {
      token: tokenOf(accepted) ?? "",
      csrf: accepted.json<{ csrf: string }>().csrf,
      accountId: "",
    };

    expect(accepted.json()).toMatchObject({ stage: "mfa-enrol" });
    expect((await t.send("GET", "/api/panels", { session })).body).toBe("app not found");
    expect((await t.send("POST", "/api/auth/totp/start", { session })).statusCode).toBe(200);
  });

  it("refuses a weak password on accept and keeps the invite usable", async () => {
    const t = await createApp();
    const { created } = await invite(t);
    const weak = await t.send("POST", "/api/auth/invite/accept", {
      body: { token: created.token, password: "short" },
    });

    expect(weak.statusCode).toBe(422);
    expect(weak.json()).toMatchObject({ code: "auth.password-too-short" });
    expect(
      (
        await t.send("POST", "/api/auth/invite/accept", {
          body: { token: created.token, password: PASSWORD },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("revokes an invite so its token stops working", async () => {
    const t = await createApp();
    const { admin, created } = await invite(t);
    const revoked = await t.send("DELETE", `/api/admin/invites/${created.invite.id}`, {
      session: admin,
    });

    expect(revoked.statusCode).toBe(204);
    expect(
      (await t.send("POST", "/api/auth/invite/inspect", { body: { token: created.token } }))
        .statusCode,
    ).toBe(410);
  });

  it("refuses an invite for an email that already has an account", async () => {
    const t = await createApp();
    const admin = await t.signIn("admin@example.com", "admin");
    const response = await t.send("POST", "/api/admin/invites", {
      session: admin,
      body: { email: "ADMIN@example.com", role: "viewer" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "invite.email-taken" });
  });

  it("validates the invite body", async () => {
    const t = await createApp();
    const admin = await t.signIn("admin@example.com", "admin");

    for (const body of [
      {},
      { email: "not-an-email", role: "viewer" },
      { email: "a@b.co", role: "owner" },
      { email: "a@b.co" },
      { email: 5, role: "viewer" },
    ]) {
      const response = await t.send("POST", "/api/admin/invites", { session: admin, body });

      expect(response.statusCode, JSON.stringify(body)).toBe(422);
      expect(response.json()).toMatchObject({ code: "input.invalid" });
    }
  });

  it("keeps invite creation, revoking and the user list admin-only", async () => {
    const t = await createApp();
    const viewer = await t.signIn("viewer@example.com");

    for (const [method, route, body] of [
      ["POST", "/api/admin/invites", { email: "a@b.co", role: "viewer" }],
      ["DELETE", "/api/admin/invites/x", undefined],
      ["GET", "/api/admin/users", undefined],
    ] as const) {
      const response = await t.send(method, route, { session: viewer, ...(body ? { body } : {}) });

      expect(response.statusCode, route).toBe(403);
      expect(response.json()).toMatchObject({ code: "role.forbidden" });
    }
  });

  it("audits the invite lifecycle", async () => {
    const t = await createApp();
    const { admin, created } = await invite(t);

    await t.send("POST", "/api/auth/invite/accept", {
      body: { token: created.token, password: PASSWORD },
    });

    const audit = await t.send("GET", "/api/admin/audit?type=invite.created,invite.accepted", {
      session: admin,
    });
    const types = audit.json<{ type: string }[]>().map((entry) => entry.type);

    expect(audit.statusCode).toBe(200);
    expect(types).toContain("invite.created");
    expect(types).toContain("invite.accepted");
  });
});
