import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../../../src/production/store/memory-store";
import { createApp } from "./harness";

const TTL = 5000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the disable switch", () => {
  it("closes the instance that handled it at once and the others after the cache time", async () => {
    const store = createMemoryStore();
    const first = await createApp({ store });
    const second = await createApp({ store });
    const admin = await first.signIn("admin@example.com", "admin");

    // The second instance has read the open state, so it caches it.
    expect((await second.send("GET", "/")).statusCode).toBe(200);

    const response = await first.send("POST", "/api/admin/disable", {
      session: admin,
      body: { confirm: "disable" },
    });

    expect(response.statusCode).toBe(204);
    expect((await first.send("GET", "/")).statusCode).toBe(404);
    expect((await first.send("GET", "/api/panels", { session: admin })).statusCode).toBe(404);

    // Within the cache time the second instance still answers.
    vi.advanceTimersByTime(TTL - 1);
    expect((await second.send("GET", "/")).statusCode).toBe(200);

    vi.advanceTimersByTime(2);
    expect((await second.send("GET", "/")).statusCode).toBe(404);
    expect((await second.send("GET", "/api/auth/session")).statusCode).toBe(404);
  });

  it("is audited and survives a restart (a new mount over the same store stays closed)", async () => {
    const store = createMemoryStore();
    const first = await createApp({ store });
    const admin = await first.signIn("admin@example.com", "admin");

    await first.send("POST", "/api/admin/disable", {
      session: admin,
      body: { confirm: "disable" },
    });

    const entries = await store.audit.list({ types: ["dashboard.disabled"], limit: 5 });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.accountId).toBe(admin.accountId);

    const restarted = await createApp({ store });

    expect((await restarted.send("GET", "/")).statusCode).toBe(404);
  });

  it("needs the exact confirmation, an admin and the CSRF token", async () => {
    const t = await createApp();
    const admin = await t.signIn("admin@example.com", "admin");
    const viewer = await t.signIn("viewer@example.com");

    expect(
      (
        await t.send("POST", "/api/admin/disable", { session: admin, body: { confirm: "yes" } })
      ).json(),
    ).toMatchObject({ code: "input.invalid" });
    expect(
      (await t.send("POST", "/api/admin/disable", { session: admin, body: {} })).json(),
    ).toMatchObject({ code: "input.invalid" });
    expect(
      (
        await t.send("POST", "/api/admin/disable", {
          session: viewer,
          body: { confirm: "disable" },
        })
      ).json(),
    ).toMatchObject({ code: "role.forbidden" });
    expect(
      (
        await t.send("POST", "/api/admin/disable", {
          session: { ...admin, csrf: "wrong" },
          body: { confirm: "disable" },
        })
      ).json(),
    ).toMatchObject({ code: "csrf.invalid" });
    expect((await t.send("GET", "/")).statusCode).toBe(200);
  });

  it("applies to its own path only: another path over the same store is open", async () => {
    const store = createMemoryStore();
    const first = await createApp({ store });
    const admin = await first.signIn("admin@example.com", "admin");

    await first.send("POST", "/api/admin/disable", {
      session: admin,
      body: { confirm: "disable" },
    });

    const other = await createApp({ store, production: { path: "/ops-new-path-0042" } });

    expect((await first.send("GET", "/")).statusCode).toBe(404);
    expect((await other.send("GET", "/")).statusCode).toBe(200);
  });

  it("reopens when the state is reset the way the command line does", async () => {
    const store = createMemoryStore();
    const t = await createApp({ store });
    const admin = await t.signIn("admin@example.com", "admin");

    await t.send("POST", "/api/admin/disable", { session: admin, body: { confirm: "disable" } });
    expect((await t.send("GET", "/")).statusCode).toBe(404);

    const state = await store.state.read();

    await store.state.update(state.version, {
      disabled: false,
      disabledPathHash: null,
      disabledAt: null,
      disabledBy: null,
      lockedUntil: null,
      failuresResetAt: Date.now(),
    });

    // The command line cannot reach this process, so the cache time applies.
    vi.advanceTimersByTime(TTL + 1);

    expect((await t.send("GET", "/")).statusCode).toBe(200);
  });

  it("closes for the lock time after the global failure limit and opens when it ends", async () => {
    const store = createMemoryStore();
    const t = await createApp({ store });

    await store.state.update(0, { lockedUntil: Date.now() + 15 * 60_000 });
    t.state.invalidate();

    expect((await t.send("GET", "/")).statusCode).toBe(404);

    vi.advanceTimersByTime(15 * 60_000 + TTL + 1);

    expect((await t.send("GET", "/")).statusCode).toBe(200);
  });

  it("reads the store at most once per cache time", async () => {
    const store = createMemoryStore();
    const read = vi.spyOn(store.state, "read");
    const t = await createApp({ store });

    for (let index = 0; index < 5; index += 1) await t.send("GET", "/");

    expect(read).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(TTL + 1);
    await t.send("GET", "/");

    expect(read).toHaveBeenCalledTimes(2);
  });
});
