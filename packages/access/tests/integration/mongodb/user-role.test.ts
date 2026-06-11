import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole } from "../../../src/models/user-role.model";
import { matchesPermission } from "../../../src/services/matcher";
import { ModelAccessResolver } from "../../../src/services/model-resolver";
import { startMongodbHarness, type MongodbHarness } from "../helpers/mongodb-harness";

/**
 * The `UserRole` model + `ModelAccessResolver` against a REAL MongoDB container,
 * re-running the Postgres contract on the OTHER driver to prove the model
 * statics are genuinely driver-agnostic. Collections auto-create — no migration.
 */

const USER = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userType: "user" } as never;
const OTHER = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", userType: "user" } as never;
const rolesMap = { editor: ["orders.*", "posts.create"], viewer: ["orders.view"] };

let harness: MongodbHarness;

beforeAll(async () => {
  harness = await startMongodbHarness();
}, 120_000);

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  await harness.dropCollections("user_roles");
});

describe("MongoDB — UserRole assignments", () => {
  it("assign persists a role that rolesFor reads back", async () => {
    await UserRole.assign(USER, "editor");

    expect(await UserRole.rolesFor(USER)).toEqual(["editor"]);
  });

  it("assign is idempotent — no duplicate document", async () => {
    await UserRole.assign(USER, "editor");
    await UserRole.assign(USER, "editor");

    expect(await harness.db.collection("user_roles").countDocuments()).toBe(1);
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

    expect(await UserRole.rolesFor(USER)).toEqual([]);
  });
});

describe("MongoDB — end-to-end decision", () => {
  it("real DB roles → resolver → matcher yields the correct verdict", async () => {
    await UserRole.assign(USER, "editor", "t1");

    const perms = await new ModelAccessResolver(rolesMap).permissionsOf(USER, "t1");

    expect(matchesPermission(perms, "orders.update")).toBe(true);
    expect(matchesPermission(perms, "orders.update.status")).toBe(true);
    expect(matchesPermission(perms, "posts.create")).toBe(true);
    expect(matchesPermission(perms, "posts.delete")).toBe(false);
  });
});

describe("MongoDB — ModelAccessResolver", () => {
  it("resolves roles then maps them to permissions", async () => {
    await UserRole.assign(USER, "editor", "t1");

    const resolver = new ModelAccessResolver(rolesMap);

    expect(await resolver.rolesOf(USER, "t1")).toEqual(["editor"]);
    expect(await resolver.permissionsOf(USER, "t1")).toEqual(["orders.*", "posts.create"]);
  });
});
