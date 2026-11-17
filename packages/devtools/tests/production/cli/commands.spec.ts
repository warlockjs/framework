import { beforeEach, describe, expect, it } from "vitest";
import {
  CLI_AUDIT_IP,
  reportStoreError,
  resolveAdminEmail,
  runEnable,
  runResetAdmin,
  type CliOutput,
} from "../../../src/production/cli/actions";
import {
  DEVTOOLS_CONFIG_CODES,
  DevtoolsProductionConfigError,
} from "../../../src/production/errors";
import { createMemoryStore } from "../../../src/production/store/memory-store";
import type { DevtoolsStore } from "../../../src/production/store/types";
import { newAccount, newSession } from "../store/store-contract";

const NOW = 5_000_000;

const hashPassword = async (password: string) => `hashed:${password}`;
const generatePassword = () => "Temp-Passw0rd-Fake-123";

function setup() {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliOutput = { out: (line) => void out.push(line), err: (line) => void err.push(line) };
  const store = createMemoryStore({ now: () => NOW });

  return { store, io, out, err };
}

describe("devtools:enable", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it("clears the flag, the lock and the counters, and audits", async () => {
    await ctx.store.state.update(0, {
      disabled: true,
      disabledPathHash: "hash",
      disabledAt: 1,
      disabledBy: "acc",
      lockedUntil: NOW + 60_000,
    });

    const code = await runEnable({ store: ctx.store, now: () => NOW, io: ctx.io });
    const state = await ctx.store.state.read();
    const [entry] = await ctx.store.audit.list({ limit: 10 });

    expect(code).toBe(0);
    expect(state).toMatchObject({
      disabled: false,
      disabledPathHash: null,
      lockedUntil: null,
      failuresResetAt: NOW,
    });
    expect(entry).toMatchObject({
      type: "dashboard.enabled",
      ip: CLI_AUDIT_IP,
      accountId: null,
      at: NOW,
    });
    expect(entry!.ref).toHaveLength(8);
    expect(ctx.out.join("\n")).toContain("enabled");
    expect(ctx.out.join("\n")).toContain("disable switch is cleared");
    expect(ctx.out.join("\n")).toContain("global lock is cleared");
  });

  it("works when nothing was ever disabled", async () => {
    expect(await runEnable({ store: ctx.store, now: () => NOW, io: ctx.io })).toBe(0);
    expect(ctx.out.join("\n")).toContain("was not set");
    expect(ctx.out.join("\n")).toContain("not locked");
    expect((await ctx.store.state.read()).failuresResetAt).toBe(NOW);
  });

  it("exits non-zero and says what to do when the tables are missing", async () => {
    const store: DevtoolsStore = {
      ...ctx.store,
      verify: async () => {
        throw new DevtoolsProductionConfigError("DT008");
      },
    };

    expect(await runEnable({ store, now: () => NOW, io: ctx.io })).toBe(1);
    expect(ctx.err.join("\n")).toContain("devtoolsMigrations");
    expect(ctx.err.join("\n")).toContain("warlock migrate");
  });
});

describe("devtools:reset-admin", () => {
  let ctx: ReturnType<typeof setup>;
  const run = (email: string | null) =>
    runResetAdmin(
      { store: ctx.store, now: () => NOW, io: ctx.io, generatePassword, hashPassword },
      email,
    );

  beforeEach(() => {
    ctx = setup();
  });

  it("creates the account and prints the temporary password", async () => {
    expect(await run("admin@example.com")).toBe(0);

    const account = await ctx.store.accounts.findByEmail("admin@example.com");

    expect(account).toMatchObject({
      role: "admin",
      passwordHash: "hashed:Temp-Passw0rd-Fake-123",
      passwordSource: "reset",
      mustChangePassword: true,
      totpSecret: null,
      recoveryCodes: [],
      passkeys: [],
      failuresResetAt: NOW,
      createdBy: null,
    });
    expect(ctx.out.join("\n")).toContain("was created");
    expect(ctx.out.join("\n")).toContain("Temporary password: Temp-Passw0rd-Fake-123");

    const [entry] = await ctx.store.audit.list({ limit: 10 });

    expect(entry).toMatchObject({
      type: "admin.reset",
      accountId: account!.id,
      email: "admin@example.com",
      ip: "cli",
      detail: { created: true },
    });
  });

  it("resets an existing account: role, password, factors, counters and sessions", async () => {
    const existing = await ctx.store.accounts.create(
      newAccount("admin@example.com", {
        role: "viewer",
        passwordSource: "user",
        totpSecret: "enc",
        totpEnabledAt: 1,
        totpLastStep: 2,
        recoveryCodes: ["r"],
        passkeys: [
          {
            id: "c",
            publicKey: "k",
            counter: 1,
            transports: [],
            name: "Key",
            createdAt: 1,
            lastUsedAt: null,
          },
        ],
      }),
    );

    await ctx.store.sessions.create(newSession(existing.id, "h1"));
    await ctx.store.sessions.create(newSession(existing.id, "h2"));
    await ctx.store.sessions.create(newSession("someone-else", "h3"));

    expect(await run("admin@example.com")).toBe(0);

    const account = await ctx.store.accounts.findById(existing.id);

    expect(account).toMatchObject({
      role: "admin",
      passwordHash: "hashed:Temp-Passw0rd-Fake-123",
      passwordSource: "reset",
      mustChangePassword: true,
      totpSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      recoveryCodes: [],
      passkeys: [],
      failuresResetAt: NOW,
    });
    expect(account!.version).toBe(existing.version + 1);
    expect(await ctx.store.sessions.listForAccount(existing.id)).toEqual([]);
    expect(await ctx.store.sessions.findByTokenHash("h3")).not.toBeNull();
    expect(await ctx.store.accounts.list()).toHaveLength(1);
    expect(ctx.out.join("\n")).toContain("was reset");
    expect(ctx.out.join("\n")).toContain("2 open session(s)");

    const [entry] = await ctx.store.audit.list({ limit: 10 });

    expect(entry).toMatchObject({
      type: "admin.reset",
      detail: { created: false, sessionsRemoved: 2 },
    });
  });

  it("asks for an email when none is given", async () => {
    expect(await run(null)).toBe(1);
    expect(ctx.err.join("\n")).toContain("--email");
    expect(await ctx.store.accounts.list()).toEqual([]);
  });

  it("refuses a value that is not an email", async () => {
    expect(await run("nonsense")).toBe(1);
    expect(ctx.err.join("\n")).toContain("not an email address");
  });

  it("reports an unreachable database with what to do", async () => {
    const store: DevtoolsStore = {
      ...ctx.store,
      verify: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
      },
    };

    const code = await runResetAdmin(
      { store, now: () => NOW, io: ctx.io, generatePassword, hashPassword },
      "a@example.com",
    );

    expect(code).toBe(1);
    expect(ctx.err.join("\n")).toContain("ECONNREFUSED");
    expect(ctx.err.join("\n")).toContain("then run the command again");
    expect(ctx.err.join("\n")).toContain(DEVTOOLS_CONFIG_CODES.DT008);
  });

  it("resolves the email from the option or the environment, lower-cased", () => {
    expect(resolveAdminEmail("  Admin@Example.COM ", {})).toBe("admin@example.com");
    expect(resolveAdminEmail(undefined, { DEVTOOLS_ADMIN_EMAIL: "Env@Example.com" })).toBe(
      "env@example.com",
    );
    expect(resolveAdminEmail("", { DEVTOOLS_ADMIN_EMAIL: "env@example.com" })).toBe(
      "env@example.com",
    );
    expect(resolveAdminEmail(undefined, {})).toBeNull();
  });

  it("prints a config error as it is", () => {
    const { io, err } = setup();

    expect(reportStoreError(io, new DevtoolsProductionConfigError("DT005"))).toBe(1);
    expect(err[0]).toContain("DT005");
  });
});
