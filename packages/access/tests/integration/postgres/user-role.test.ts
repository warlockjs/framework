import { MigrationRunner } from "@warlock.js/cascade";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole } from "../../../src/models/user-role.model";
import { UserRoleMigration } from "../../../src/models/user-role.migration";
import { matchesPermission } from "../../../src/services/matcher";
import { ModelAccessResolver } from "../../../src/services/model-resolver";
import { startPostgresHarness, type PostgresHarness } from "../helpers/postgres-harness";

/**
 * The `UserRole` model + `ModelAccessResolver` against a REAL Postgres
 * container. Proves the DB-backed resolution mocks can't: the migration runs,
 * assign/revoke persist, tenant scoping filters correctly, and roles map to
 * permissions.
 */

const USER = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userType: "user" } as never;
const OTHER = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", userType: "user" } as never;
const rolesMap = { editor: ["orders.*", "posts.create"], viewer: ["orders.view"] };

let harness: PostgresHarness;

beforeAll(async () => {
  harness = await startPostgresHarness();

  const runner = new MigrationRunner({ dataSource: harness.dataSource, verbose: false });
  await runner.run(UserRoleMigration);
}, 120_000);

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  await harness.query(`TRUNCATE TABLE "user_roles"`);
});

describe("Postgres — UserRole assignments", () => {
  it("assign persists a role that rolesFor reads back", async () => {
    await UserRole.assign(USER, "editor");

    expect(await UserRole.rolesFor(USER)).toEqual(["editor"]);
  });

  it("assign is idempotent — no duplicate row", async () => {
    await UserRole.assign(USER, "editor");
    await UserRole.assign(USER, "editor");

    const rows = await harness.query(`SELECT role FROM "user_roles"`);
    expect(rows.rowCount).toBe(1);
  });

  it("revoke removes the assignment", async () => {
    await UserRole.assign(USER, "editor");
    await UserRole.revoke(USER, "editor");

    expect(await UserRole.rolesFor(USER)).toEqual([]);
  });

  it("scopes roles per tenant", async () => {
    await UserRole.assign(USER, "editor", "t1");
    await UserRole.assign(USER, "viewer", "t2");

    expect(await UserRole.rolesFor(USER, "t1")).toEqual(["editor"]);
    expect(await UserRole.rolesFor(USER, "t2")).toEqual(["viewer"]);
  });

  it("isolates one user's roles from another", async () => {
    await UserRole.assign(USER, "editor");

    expect(await UserRole.rolesFor(OTHER)).toEqual([]);
  });

  it("does NOT bleed tenant-scoped roles into an unresolved-tenant query (security)", async () => {
    await UserRole.assign(USER, "editor", "t1");
    await UserRole.assign(USER, "viewer", "t2");

    // an undefined tenant must scope to global (null) rows only — never the union
    expect(await UserRole.rolesFor(USER)).toEqual([]);
  });
});

describe("Postgres — end-to-end decision", () => {
  it("real DB roles → resolver → matcher yields the correct verdict", async () => {
    await UserRole.assign(USER, "editor", "t1");

    const perms = await new ModelAccessResolver(rolesMap).permissionsOf(USER, "t1");

    expect(matchesPermission(perms, "orders.update")).toBe(true);
    expect(matchesPermission(perms, "orders.update.status")).toBe(true); // wildcard, nested
    expect(matchesPermission(perms, "posts.create")).toBe(true);
    expect(matchesPermission(perms, "posts.delete")).toBe(false);
  });
});

describe("Postgres — ModelAccessResolver", () => {
  it("resolves roles then maps them to permissions", async () => {
    await UserRole.assign(USER, "editor", "t1");

    const resolver = new ModelAccessResolver(rolesMap);

    expect(await resolver.rolesOf(USER, "t1")).toEqual(["editor"]);
    expect(await resolver.permissionsOf(USER, "t1")).toEqual(["orders.*", "posts.create"]);
  });
});

describe("Postgres — schema parity", () => {
  it("user_roles carries every column the model writes", async () => {
    const columns = await harness.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      ["user_roles"],
    );

    const names = new Set(columns.rows.map((row) => row.column_name));

    for (const column of ["user_id", "user_type", "role", "tenant"]) {
      expect(names.has(column)).toBe(true);
    }
  });
});
