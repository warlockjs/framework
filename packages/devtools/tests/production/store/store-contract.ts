import { beforeEach, describe, expect, it } from "vitest";
import type { DevtoolsAuditEntry, DevtoolsInstanceReport } from "../../../src/production/contracts";
import { DevtoolsStoreConflictError } from "../../../src/production/errors";
import type {
  DevtoolsStore,
  DevtoolsStoredSample,
  NewDevtoolsAccount,
  NewDevtoolsInvite,
  NewDevtoolsSession,
} from "../../../src/production/store/types";

/** A store under test and the clock it stamps with. */
export type StoreUnderTest = {
  store: DevtoolsStore;
  /** Moves the store's clock to `at`. */
  setNow(at: number): void;
};

export type MakeStore = () => Promise<StoreUnderTest> | StoreUnderTest;

export function newAccount(
  email: string,
  overrides: Partial<NewDevtoolsAccount> = {},
): NewDevtoolsAccount {
  return {
    email,
    role: "viewer",
    passwordHash: "hash",
    passwordSource: "user",
    mustChangePassword: false,
    totpSecret: null,
    totpEnabledAt: null,
    totpLastStep: null,
    recoveryCodes: ["a1", "b2"],
    passkeys: [],
    failuresResetAt: null,
    lastLoginAt: null,
    createdBy: null,
    ...overrides,
  };
}

export function newSession(
  accountId: string,
  tokenHash: string,
  overrides: Partial<NewDevtoolsSession> = {},
): NewDevtoolsSession {
  return {
    tokenHash,
    accountId,
    stage: "active",
    csrfSecret: "csrf",
    createdAt: 1000,
    lastSeenAt: 1000,
    expiresAt: 5000,
    ip: "10.0.0.1",
    userAgent: "agent",
    pendingTotpSecret: null,
    challenge: null,
    challengeExpiresAt: null,
    ...overrides,
  };
}

export function newInvite(
  tokenHash: string,
  overrides: Partial<NewDevtoolsInvite> = {},
): NewDevtoolsInvite {
  return {
    tokenHash,
    email: "new@example.com",
    role: "viewer",
    createdBy: null,
    createdAt: 1000,
    expiresAt: 5000,
    ...overrides,
  };
}

export function auditEntry(
  at: number,
  overrides: Partial<Omit<DevtoolsAuditEntry, "id">> = {},
): Omit<DevtoolsAuditEntry, "id"> {
  return {
    at,
    type: "login.failed",
    accountId: null,
    email: null,
    ip: "10.0.0.1",
    userAgent: null,
    detail: {},
    ref: "REF00001",
    ...overrides,
  };
}

export function sample(
  id: string,
  startedAt: number,
  overrides: Partial<DevtoolsStoredSample["summary"]> & {
    instance?: string;
    detail?: boolean;
  } = {},
): DevtoolsStoredSample {
  const { instance = "i1", detail = true, ...summaryOverrides } = overrides;
  const summary = {
    id,
    method: "GET",
    path: "/users",
    route: "/users",
    status: 200,
    startedAt,
    durationMs: 12,
    queryCount: 2,
    warningCount: 0,
    instance,
    ...summaryOverrides,
  };

  return {
    id,
    instance,
    startedAt,
    summary,
    detail: detail
      ? {
          ...summary,
          phases: [],
          queries: [],
          cache: { hits: 0, misses: 0, writes: 0 },
          logs: [],
          warnings: [],
          droppedQueries: 0,
          // Keys that MongoDB would treat specially must survive.
          ...({ headers: { $where: "x", "a.b": "y" } } as object),
        }
      : null,
  };
}

export function report(instanceId: string, at: number): DevtoolsInstanceReport {
  return {
    instance: {
      id: instanceId,
      label: instanceId,
      host: "h",
      pid: 1,
      worker: null,
      startedAt: 1,
      seenAt: at,
      nodeVersion: "22",
    },
    at,
    queries: [],
    routes: [],
    errors: [],
    logs: [],
  } as unknown as DevtoolsInstanceReport;
}

/**
 * The behaviour every `DevtoolsStore` must have. Run on the memory store
 * always, and on the cascade store when a database is available.
 */
export function describeStoreContract(name: string, makeStore: MakeStore): void {
  describe(`${name} store contract`, () => {
    let store: DevtoolsStore;
    let setNow: (at: number) => void;

    beforeEach(async () => {
      ({ store, setNow } = await makeStore());
      setNow(1000);
    });

    describe("accounts", () => {
      it("creates, finds and copies records", async () => {
        const created = await store.accounts.create(newAccount("a@example.com", { role: "admin" }));

        expect(created).toMatchObject({
          email: "a@example.com",
          role: "admin",
          version: 1,
          createdAt: 1000,
          updatedAt: 1000,
        });
        expect(created.id).toBeTruthy();
        expect(created.recoveryCodes).toEqual(["a1", "b2"]);

        expect(await store.accounts.findByEmail("a@example.com")).toEqual(created);
        expect(await store.accounts.findById(created.id)).toEqual(created);
        expect(await store.accounts.findByEmail("none@example.com")).toBeNull();
        expect(await store.accounts.findById("none")).toBeNull();

        const copy = await store.accounts.findById(created.id);

        copy!.recoveryCodes.push("mutated");

        expect((await store.accounts.findById(created.id))!.recoveryCodes).toEqual(["a1", "b2"]);
      });

      it("keeps nullable fields and passkeys", async () => {
        const passkey = {
          id: "cred",
          publicKey: "pk",
          counter: 3,
          transports: ["usb"],
          name: "Key",
          createdAt: 5,
          lastUsedAt: null,
        };
        const created = await store.accounts.create(
          newAccount("p@example.com", {
            passkeys: [passkey],
            totpSecret: "enc",
            totpEnabledAt: 7,
            totpLastStep: 9,
            mustChangePassword: true,
          }),
        );
        const found = await store.accounts.findById(created.id);

        expect(found).toMatchObject({
          passkeys: [passkey],
          totpSecret: "enc",
          totpEnabledAt: 7,
          totpLastStep: 9,
          mustChangePassword: true,
          lastLoginAt: null,
          createdBy: null,
        });
      });

      it("refuses a duplicate email", async () => {
        await store.accounts.create(newAccount("a@example.com"));

        await expect(store.accounts.create(newAccount("a@example.com"))).rejects.toBeInstanceOf(
          DevtoolsStoreConflictError,
        );
      });

      it("lists oldest first and counts admins", async () => {
        setNow(3000);
        await store.accounts.create(newAccount("late@example.com"));
        setNow(2000);
        await store.accounts.create(newAccount("early@example.com", { role: "admin" }));

        expect((await store.accounts.list()).map((account) => account.email)).toEqual([
          "early@example.com",
          "late@example.com",
        ]);
        expect(await store.accounts.countAdmins()).toBe(1);
      });

      it("updates with the expected version and bumps version and updatedAt", async () => {
        const created = await store.accounts.create(newAccount("a@example.com"));

        setNow(2000);

        const updated = await store.accounts.update(created.id, 1, {
          role: "admin",
          totpSecret: "s",
          recoveryCodes: [],
        });

        expect(updated).toMatchObject({
          role: "admin",
          totpSecret: "s",
          recoveryCodes: [],
          version: 2,
          updatedAt: 2000,
          createdAt: 1000,
        });
        expect(await store.accounts.findById(created.id)).toEqual(updated);
      });

      it("returns null for a stale version or a missing account", async () => {
        const created = await store.accounts.create(newAccount("a@example.com"));

        await store.accounts.update(created.id, 1, { role: "admin" });

        expect(await store.accounts.update(created.id, 1, { role: "viewer" })).toBeNull();
        expect(await store.accounts.update("missing", 1, { role: "viewer" })).toBeNull();
        expect((await store.accounts.findById(created.id))!.role).toBe("admin");
      });

      it("lets exactly one of two updates with the same version win", async () => {
        const created = await store.accounts.create(newAccount("a@example.com"));
        const results = await Promise.all([
          store.accounts.update(created.id, 1, { lastLoginAt: 1 }),
          store.accounts.update(created.id, 1, { lastLoginAt: 2 }),
        ]);

        expect(results.filter((result) => result !== null)).toHaveLength(1);
        expect((await store.accounts.findById(created.id))!.version).toBe(2);
      });

      it("refuses to change an email into a taken one", async () => {
        await store.accounts.create(newAccount("a@example.com"));

        const other = await store.accounts.create(newAccount("b@example.com"));

        await expect(
          store.accounts.update(other.id, 1, { email: "a@example.com" }),
        ).rejects.toBeInstanceOf(DevtoolsStoreConflictError);
        expect((await store.accounts.findById(other.id))!.email).toBe("b@example.com");
      });

      it("removes", async () => {
        const created = await store.accounts.create(newAccount("a@example.com"));

        expect(await store.accounts.remove(created.id)).toBe(true);
        expect(await store.accounts.remove(created.id)).toBe(false);
        expect(await store.accounts.findById(created.id)).toBeNull();
      });
    });

    describe("sessions", () => {
      it("creates and finds by token hash", async () => {
        const created = await store.sessions.create(
          newSession("acc", "h1", {
            challenge: "c",
            challengeExpiresAt: 77,
            pendingTotpSecret: "p",
          }),
        );

        expect(created).toMatchObject({
          accountId: "acc",
          tokenHash: "h1",
          version: 1,
          challenge: "c",
          challengeExpiresAt: 77,
          pendingTotpSecret: "p",
          ip: "10.0.0.1",
        });
        expect(await store.sessions.findByTokenHash("h1")).toEqual(created);
        expect(await store.sessions.findByTokenHash("nope")).toBeNull();
      });

      it("lists an account's sessions newest first", async () => {
        await store.sessions.create(newSession("acc", "h1", { createdAt: 1 }));
        await store.sessions.create(newSession("acc", "h2", { createdAt: 3 }));
        await store.sessions.create(newSession("acc", "h3", { createdAt: 2 }));
        await store.sessions.create(newSession("other", "h4", { createdAt: 9 }));

        expect(
          (await store.sessions.listForAccount("acc")).map((session) => session.tokenHash),
        ).toEqual(["h2", "h3", "h1"]);
      });

      it("updates by compare-and-set; one of two racing updates wins", async () => {
        const created = await store.sessions.create(newSession("acc", "h1"));
        const updated = await store.sessions.update(created.id, 1, {
          stage: "mfa-verify",
          lastSeenAt: 2000,
          challenge: "x",
        });

        expect(updated).toMatchObject({
          stage: "mfa-verify",
          lastSeenAt: 2000,
          challenge: "x",
          version: 2,
          accountId: "acc",
        });
        expect(await store.sessions.update(created.id, 1, { lastSeenAt: 1 })).toBeNull();

        const race = await Promise.all([
          store.sessions.update(created.id, 2, { lastSeenAt: 3000 }),
          store.sessions.update(created.id, 2, { lastSeenAt: 4000 }),
        ]);

        expect(race.filter((result) => result !== null)).toHaveLength(1);
      });

      it("can clear a challenge", async () => {
        const created = await store.sessions.create(
          newSession("acc", "h1", { challenge: "c", challengeExpiresAt: 9 }),
        );
        const updated = await store.sessions.update(created.id, 1, {
          challenge: null,
          challengeExpiresAt: null,
        });

        expect(updated).toMatchObject({ challenge: null, challengeExpiresAt: null });
      });

      it("removes one, an account's (except one) and expired sessions", async () => {
        const a = await store.sessions.create(newSession("acc", "h1", { expiresAt: 1500 }));
        const b = await store.sessions.create(newSession("acc", "h2", { expiresAt: 9000 }));

        await store.sessions.create(newSession("acc", "h3", { expiresAt: 9000 }));
        await store.sessions.create(newSession("other", "h4", { expiresAt: 9000 }));

        expect(await store.sessions.remove(a.id)).toBe(true);
        expect(await store.sessions.remove(a.id)).toBe(false);
        expect(await store.sessions.removeForAccount("acc", b.id)).toBe(1);
        expect((await store.sessions.listForAccount("acc")).map((session) => session.id)).toEqual([
          b.id,
        ]);
        expect(await store.sessions.removeForAccount("acc")).toBe(1);
        expect(await store.sessions.listForAccount("acc")).toEqual([]);

        await store.sessions.create(newSession("x", "e1", { expiresAt: 1999 }));
        await store.sessions.create(newSession("x", "e2", { expiresAt: 2000 }));

        expect(await store.sessions.removeExpired(2000)).toBe(1);
        expect(await store.sessions.findByTokenHash("e2")).not.toBeNull();
        expect(await store.sessions.findByTokenHash("h4")).not.toBeNull();
      });
    });

    describe("invites", () => {
      it("creates, finds, lists newest first and hides used invites", async () => {
        const first = await store.invites.create(newInvite("t1", { createdAt: 1 }));
        const second = await store.invites.create(newInvite("t2", { createdAt: 2 }));

        expect(first).toMatchObject({ usedAt: null, accountId: null });
        expect(await store.invites.findByTokenHash("t1")).toEqual(first);
        expect(await store.invites.findByTokenHash("zz")).toBeNull();
        expect((await store.invites.list()).map((invite) => invite.id)).toEqual([
          second.id,
          first.id,
        ]);

        expect(await store.invites.markUsed(first.id, 1500, "acc")).toBe(true);
        expect((await store.invites.list()).map((invite) => invite.id)).toEqual([second.id]);
        expect(
          (await store.invites.list({ includeUsed: true })).map((invite) => invite.id),
        ).toEqual([second.id, first.id]);
        expect(await store.invites.findByTokenHash("t1")).toMatchObject({
          usedAt: 1500,
          accountId: "acc",
        });
      });

      it("marks used once, and not after it expired", async () => {
        const invite = await store.invites.create(newInvite("t1", { expiresAt: 2000 }));

        expect(await store.invites.markUsed(invite.id, 2000, "acc")).toBe(false);
        expect(await store.invites.markUsed(invite.id, 1999, "acc")).toBe(true);
        expect(await store.invites.markUsed(invite.id, 1999, "acc2")).toBe(false);
        expect((await store.invites.findByTokenHash("t1"))!.accountId).toBe("acc");
      });

      it("lets exactly one of two racing uses win", async () => {
        const invite = await store.invites.create(newInvite("t1"));
        const results = await Promise.all([
          store.invites.markUsed(invite.id, 1500, "a"),
          store.invites.markUsed(invite.id, 1500, "b"),
        ]);

        expect(results.filter(Boolean)).toHaveLength(1);
      });

      it("removes, and removes expired unused invites only", async () => {
        const gone = await store.invites.create(newInvite("t1"));
        const expired = await store.invites.create(newInvite("t2", { expiresAt: 1500 }));
        const usedExpired = await store.invites.create(newInvite("t3", { expiresAt: 1600 }));

        await store.invites.markUsed(usedExpired.id, 1000, "acc");

        expect(await store.invites.remove(gone.id)).toBe(true);
        expect(await store.invites.remove(gone.id)).toBe(false);
        expect(await store.invites.removeExpired(2000)).toBe(1);
        expect(await store.invites.findByTokenHash("t2")).toBeNull();
        expect(expired.id).toBeTruthy();
        expect(await store.invites.findByTokenHash("t3")).not.toBeNull();
      });
    });

    describe("audit", () => {
      it("appends with an id and keeps the caller's fields", async () => {
        const entry = await store.audit.append(
          auditEntry(10, {
            type: "admin.reset",
            email: "a@example.com",
            detail: { n: 1, ok: true, s: "x", none: null },
          }),
        );

        expect(entry.id).toBeTruthy();
        expect(entry).toMatchObject({
          at: 10,
          type: "admin.reset",
          email: "a@example.com",
          ip: "10.0.0.1",
          ref: "REF00001",
          detail: { n: 1, ok: true, s: "x", none: null },
        });
      });

      it("lists newest first, filtered, paged and clamped", async () => {
        for (let i = 1; i <= 5; i++) {
          await store.audit.append(
            auditEntry(i * 10, {
              type: i % 2 ? "login.failed" : "login.succeeded",
              accountId: i < 3 ? "a" : "b",
            }),
          );
        }

        expect((await store.audit.list({ limit: 10 })).map((entry) => entry.at)).toEqual([
          50, 40, 30, 20, 10,
        ]);
        expect((await store.audit.list({ limit: 2 })).map((entry) => entry.at)).toEqual([50, 40]);
        expect(
          (await store.audit.list({ limit: 10, before: 40 })).map((entry) => entry.at),
        ).toEqual([30, 20, 10]);
        expect(
          (await store.audit.list({ limit: 10, types: ["login.failed"] })).map((entry) => entry.at),
        ).toEqual([50, 30, 10]);
        expect(
          (await store.audit.list({ limit: 10, accountId: "a" })).map((entry) => entry.at),
        ).toEqual([20, 10]);
        expect(await store.audit.list({ limit: 0 })).toHaveLength(1);
      });

      it("counts by type, time, account and ip", async () => {
        await store.audit.append(
          auditEntry(10, { type: "login.failed", ip: "1.1.1.1", accountId: "a" }),
        );
        await store.audit.append(
          auditEntry(20, { type: "login.failed", ip: "2.2.2.2", accountId: "a" }),
        );
        await store.audit.append(
          auditEntry(30, { type: "mfa.failed", ip: "1.1.1.1", accountId: "b" }),
        );
        await store.audit.append(auditEntry(40, { type: "logout", ip: "1.1.1.1", accountId: "a" }));

        expect(await store.audit.count({ types: ["login.failed", "mfa.failed"], since: 0 })).toBe(
          3,
        );
        expect(await store.audit.count({ types: ["login.failed", "mfa.failed"], since: 20 })).toBe(
          2,
        );
        expect(await store.audit.count({ types: ["login.failed"], since: 0, ip: "1.1.1.1" })).toBe(
          1,
        );
        expect(
          await store.audit.count({
            types: ["login.failed", "mfa.failed"],
            since: 0,
            accountId: "a",
          }),
        ).toBe(2);
        expect(
          await store.audit.count({
            types: ["login.failed"],
            since: 0,
            accountId: "a",
            ip: "2.2.2.2",
          }),
        ).toBe(1);
      });

      it("counts IPv6 addresses by their /64 and IPv4-mapped addresses as IPv4", async () => {
        await store.audit.append(auditEntry(10, { type: "login.failed", ip: "2001:db8:1:2::1" }));
        await store.audit.append(auditEntry(20, { type: "login.failed", ip: "2001:db8:1:2:ffff::9" }));
        await store.audit.append(auditEntry(30, { type: "login.failed", ip: "2001:db8:1:3::1" }));
        await store.audit.append(auditEntry(40, { type: "login.failed", ip: "::ffff:1.1.1.1" }));
        await store.audit.append(auditEntry(50, { type: "login.failed", ip: "1.1.1.1" }));

        expect(
          await store.audit.count({ types: ["login.failed"], since: 0, ip: "2001:DB8:1:2::abcd" }),
        ).toBe(2);
        expect(await store.audit.count({ types: ["login.failed"], since: 0, ip: "1.1.1.1" })).toBe(2);
        // The full address is kept for the Audit screen.
        expect((await store.audit.list({ limit: 10 })).map((entry) => entry.ip)).toContain(
          "2001:db8:1:2:ffff::9",
        );
      });

      it("prunes entries before a time", async () => {
        await store.audit.append(auditEntry(10));
        await store.audit.append(auditEntry(20));
        await store.audit.append(auditEntry(30));

        expect(await store.audit.prune(20)).toBe(1);
        expect((await store.audit.list({ limit: 10 })).map((entry) => entry.at)).toEqual([30, 20]);
      });
    });

    describe("state", () => {
      it("reads a default row before any write", async () => {
        expect(await store.state.read()).toMatchObject({
          disabled: false,
          disabledPathHash: null,
          lockedUntil: null,
          failuresResetAt: null,
          version: 0,
        });
      });

      it("creates the row on the first write and updates by version", async () => {
        const first = await store.state.update(0, {
          disabled: true,
          disabledPathHash: "hash",
          disabledBy: "acc",
          disabledAt: 1000,
        });

        expect(first).toMatchObject({
          disabled: true,
          disabledPathHash: "hash",
          disabledBy: "acc",
          version: 1,
          updatedAt: 1000,
        });
        expect(await store.state.read()).toEqual(first);

        setNow(2000);

        const second = await store.state.update(1, { disabled: false, lockedUntil: 9000 });

        expect(second).toMatchObject({
          disabled: false,
          lockedUntil: 9000,
          disabledPathHash: "hash",
          version: 2,
          updatedAt: 2000,
        });
        expect(await store.state.update(1, { disabled: true })).toBeNull();
        expect(await store.state.update(0, { disabled: true })).toBeNull();
      });

      it("lets exactly one of two first writes win", async () => {
        const results = await Promise.all([
          store.state.update(0, { lockedUntil: 1 }),
          store.state.update(0, { lockedUntil: 2 }),
        ]);

        expect(results.filter((result) => result !== null)).toHaveLength(1);
        expect((await store.state.read()).version).toBe(1);
      });

      it("lets exactly one of two racing updates win", async () => {
        await store.state.update(0, {});

        const results = await Promise.all([
          store.state.update(1, { lockedUntil: 1 }),
          store.state.update(1, { lockedUntil: 2 }),
        ]);

        expect(results.filter((result) => result !== null)).toHaveLength(1);
        expect((await store.state.read()).version).toBe(2);
      });

      it("clears nullable fields", async () => {
        await store.state.update(0, { lockedUntil: 5, failuresResetAt: 3 });
        await store.state.update(1, { lockedUntil: null, failuresResetAt: 4 });

        expect(await store.state.read()).toMatchObject({ lockedUntil: null, failuresResetAt: 4 });
      });
    });

    describe("samples", () => {
      it("inserts, gets and replaces by id", async () => {
        await store.samples.insert([sample("r1", 100), sample("r2", 200, { detail: false })]);

        const stored = await store.samples.get("r1");

        expect(stored).toEqual(sample("r1", 100));
        expect((await store.samples.get("r2"))!.detail).toBeNull();
        expect(await store.samples.get("none")).toBeNull();

        await store.samples.insert([sample("r1", 100, { status: 500 })]);

        expect((await store.samples.get("r1"))!.summary.status).toBe(500);
        expect(await store.samples.list({ limit: 10 })).toHaveLength(2);
      });

      it("lists newest first and clamps the limit", async () => {
        await store.samples.insert([sample("r1", 100), sample("r2", 300), sample("r3", 200)]);

        expect((await store.samples.list({ limit: 10 })).map((summary) => summary.id)).toEqual([
          "r2",
          "r3",
          "r1",
        ]);
        expect((await store.samples.list({ limit: 2 })).map((summary) => summary.id)).toEqual([
          "r2",
          "r3",
        ]);
        expect(await store.samples.list({ limit: 0 })).toHaveLength(1);
      });

      it("filters like the development request filter", async () => {
        await store.samples.insert([
          sample("ok", 100, { status: 200, path: "/users", route: "/users" }),
          sample("nf", 200, { status: 404, path: "/missing" }),
          sample("err", 300, {
            status: 500,
            method: "POST",
            path: "/orders/7",
            route: "/orders/:id",
            instance: "i2",
          }),
          sample("part", 400, { status: 503, path: "/slow", partial: true, detail: false }),
        ]);

        const ids = async (filter: Parameters<DevtoolsStore["samples"]["list"]>[0]) =>
          (await store.samples.list(filter)).map((summary) => summary.id);

        expect(await ids({ limit: 10, status: "5xx" })).toEqual(["part", "err"]);
        expect(await ids({ limit: 10, status: "4xx" })).toEqual(["nf"]);
        expect(await ids({ limit: 10, status: "404" })).toEqual(["nf"]);
        expect(await ids({ limit: 10, status: "abc" })).toEqual([]);
        expect(await ids({ limit: 10, method: "post" })).toEqual(["err"]);
        expect(await ids({ limit: 10, route: "orders/:id" })).toEqual(["err"]);
        expect(await ids({ limit: 10, route: "MISSING" })).toEqual(["nf"]);
        expect(await ids({ limit: 10, q: "/orders" })).toEqual(["err"]);
        expect(await ids({ limit: 10, since: 200, until: 300 })).toEqual(["err", "nf"]);
        expect(await ids({ limit: 10, instance: "i2" })).toEqual(["err"]);
        expect(await ids({ limit: 1, route: "/" })).toEqual(["part"]);
        expect(await ids({ limit: 10, status: "5xx", method: "GET" })).toEqual(["part"]);

        const partial = (await store.samples.list({ limit: 10, status: "503" }))[0];

        expect(partial).toMatchObject({ partial: true });
      });

      it("prunes by start time and clears", async () => {
        await store.samples.insert([sample("r1", 100), sample("r2", 200), sample("r3", 300)]);

        expect(await store.samples.prune(200)).toBe(1);
        expect(await store.samples.get("r1")).toBeNull();
        expect(await store.samples.clear()).toBe(2);
        expect(await store.samples.list({ limit: 10 })).toEqual([]);
        expect(await store.samples.clear()).toBe(0);
      });
    });

    describe("reports", () => {
      it("upserts by instance id and lists newest first from a time", async () => {
        await store.reports.write(report("a", 100));
        await store.reports.write(report("b", 300));
        await store.reports.write(report("a", 200));

        const all = await store.reports.list(0);

        expect(all.map((entry) => [entry.instance.id, entry.at])).toEqual([
          ["b", 300],
          ["a", 200],
        ]);
        expect((await store.reports.list(250)).map((entry) => entry.instance.id)).toEqual(["b"]);
        expect(all[0]).toEqual(report("b", 300));
      });

      it("prunes and removes", async () => {
        await store.reports.write(report("a", 100));
        await store.reports.write(report("b", 300));

        expect(await store.reports.prune(200)).toBe(1);
        expect(await store.reports.remove("b")).toBe(true);
        expect(await store.reports.remove("b")).toBe(false);
        expect(await store.reports.list(0)).toEqual([]);
      });
    });

    it("verifies", async () => {
      await expect(store.verify()).resolves.toBeUndefined();
    });
  });
}
