import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
const cacheGet = vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null));
const cacheSet = vi.fn(async (key: string, value: unknown) => {
  store.set(key, value);
});
const cacheRemove = vi.fn(async (key: string) => {
  store.delete(key);
});

vi.mock("@warlock.js/cache", () => ({
  cache: {
    get: (...args: unknown[]) => cacheGet(...(args as [string])),
    set: (...args: unknown[]) => cacheSet(...(args as [string, unknown])),
    remove: (...args: unknown[]) => cacheRemove(...(args as [string])),
  },
}));

vi.mock("@warlock.js/logger", () => ({
  log: { error: vi.fn() },
}));

import { log } from "@warlock.js/logger";
import { check, flush, permissionsFor, rolesFor } from "./engine";
import { clearPolicies, definePolicy } from "./policies";
import { resetAccessConfig, setAccessConfig } from "./access-config";
import { AccessConfigError } from "../utils/access-config-error";

const resolvePermissions = vi.fn(async () => ["orders.*"]);
const resolveRoles = vi.fn(async () => ["editor"]);

const user = { id: 1, userType: "user" } as never;

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  clearPolicies();
  resolvePermissions.mockResolvedValue(["orders.*"]);
  resolveRoles.mockResolvedValue(["editor"]);
  setAccessConfig({ resolver: { resolvePermissions, resolveRoles } });
});

afterEach(() => {
  clearPolicies();
  resetAccessConfig();
});

describe("permissionsFor (caching)", () => {
  it("resolves once then serves from cache", async () => {
    const first = await permissionsFor(user);
    const second = await permissionsFor(user);

    expect(first).toEqual(["orders.*"]);
    expect(second).toEqual(["orders.*"]);
    expect(resolvePermissions).toHaveBeenCalledTimes(1);
    expect(cacheSet).toHaveBeenCalledTimes(1);
  });

  it("keys the cache by user type, id, and tenant", async () => {
    await permissionsFor(user, "tenant-1");

    expect(cacheSet).toHaveBeenCalledWith(
      "access.perms.user.1.tenant-1",
      ["orders.*"],
      expect.anything(),
    );
  });
});

describe("cache is best-effort", () => {
  it("degrades to the resolver and logs when the cache read throws", async () => {
    cacheGet.mockRejectedValueOnce(new Error("cache down"));

    const result = await permissionsFor(user);

    expect(result).toEqual(["orders.*"]);
    expect(resolvePermissions).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalled();
  });
});

describe("flush", () => {
  it("removes both the permission and role cache keys", async () => {
    await flush(user, "tenant-1");

    expect(cacheRemove).toHaveBeenCalledWith("access.perms.user.1.tenant-1");
    expect(cacheRemove).toHaveBeenCalledWith("access.roles.user.1.tenant-1");
  });
});

describe("check — grant matching", () => {
  it("allows when the resolved set covers the permission", async () => {
    expect(await check(user, "orders.update")).toBe(true);
  });

  it("denies when the resolved set does not cover the permission", async () => {
    expect(await check(user, "posts.delete")).toBe(false);
  });
});

describe("check — fail closed", () => {
  it("denies and logs when the resolver throws a generic error", async () => {
    resolvePermissions.mockRejectedValueOnce(new Error("db down"));

    expect(await check(user, "orders.update")).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it("re-throws AccessConfigError instead of swallowing it to a silent deny", async () => {
    resolvePermissions.mockRejectedValueOnce(new AccessConfigError("no resolver"));

    await expect(check(user, "orders.update")).rejects.toBeInstanceOf(AccessConfigError);
  });
});

describe("check — policies", () => {
  it("runs the policy only when a resource is supplied (instance level)", async () => {
    const policy = vi.fn(() => false);
    definePolicy("orders.update", policy);

    // class-level: no resource → policy skipped, grant wins
    expect(await check(user, "orders.update")).toBe(true);
    expect(policy).not.toHaveBeenCalled();

    // instance-level: resource present → policy decides
    expect(await check(user, "orders.update", { resource: { id: 9 } })).toBe(false);
    expect(policy).toHaveBeenCalledOnce();
  });

  it("requires BOTH the grant and the policy (AND semantics)", async () => {
    definePolicy("orders.update", () => true);

    // grant missing → policy never consulted
    resolvePermissions.mockResolvedValue(["posts.*"]);

    expect(await check(user, "orders.update", { resource: { id: 9 } })).toBe(false);
  });

  it("passes engine helpers + context into the policy", async () => {
    const policy = vi.fn(
      (_user: unknown, _resource: unknown, ctx: { hasRole: (r: string) => boolean }) =>
        ctx.hasRole("editor"),
    );
    definePolicy("orders.update", policy);

    const allowed = await check(user, "orders.update", { resource: { id: 9 }, amount: 50 });

    expect(allowed).toBe(true);
    expect(policy).toHaveBeenCalledWith(
      user,
      { id: 9 },
      expect.objectContaining({ amount: 50, tenant: undefined }),
    );
  });
});

describe("rolesFor", () => {
  it("resolves and caches the role list", async () => {
    expect(await rolesFor(user)).toEqual(["editor"]);
    expect(await rolesFor(user)).toEqual(["editor"]);
    expect(resolveRoles).toHaveBeenCalledTimes(1);
  });
});

describe("engine — best-effort cache (write + flush failure)", () => {
  it("a cache WRITE failure still resolves the loader value and logs", async () => {
    cacheSet.mockRejectedValueOnce(new Error("set down"));

    const result = await permissionsFor(user);

    expect(result).toEqual(["orders.*"]);
    expect(resolvePermissions).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalled();
  });

  it("a flush failure resolves without throwing and logs", async () => {
    cacheRemove.mockRejectedValueOnce(new Error("remove down"));

    await expect(flush(user)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });

  it("serves the cached set on a later resolver outage (real read-through)", async () => {
    await permissionsFor(user); // populate

    resolvePermissions.mockRejectedValue(new Error("db down"));

    expect(await permissionsFor(user)).toEqual(["orders.*"]); // served from cache
    expect(resolvePermissions).toHaveBeenCalledTimes(1); // resolver not re-hit
  });
});

describe("engine — ambient tenant + policy helpers", () => {
  it("resolves the ambient tenant via the resolver's resolveTenant into the cache key", async () => {
    setAccessConfig({ resolver: { resolvePermissions, resolveRoles, resolveTenant: () => "ambient-t" } });

    await check(user, "orders.update");

    expect(cacheSet).toHaveBeenCalledWith(
      "access.perms.user.1.ambient-t",
      ["orders.*"],
      expect.anything(),
    );
  });

  it("injects a working hasPermission helper into the policy", async () => {
    let coveredResult: boolean | undefined;
    let uncoveredResult: boolean | undefined;

    definePolicy("orders.update", (_user, _resource, ctx) => {
      coveredResult = ctx.hasPermission("orders.delete"); // covered by orders.*
      uncoveredResult = ctx.hasPermission("posts.delete"); // NOT covered

      return true;
    });

    await check(user, "orders.update", { resource: { id: 1 } });

    expect(coveredResult).toBe(true);
    expect(uncoveredResult).toBe(false);
  });
});
