import { beforeEach, describe, expect, it, vi } from "vitest";

const modelFirst = vi.fn();
const modelCreate = vi.fn();
const modelDelete = vi.fn();
const modelQuery = vi.fn();

vi.mock("@warlock.js/cascade", () => ({
  Model: class {
    public static first = (...args: unknown[]) => modelFirst(...args);
    public static create = (...args: unknown[]) => modelCreate(...args);
    public static delete = (...args: unknown[]) => modelDelete(...args);
    public static query = (...args: unknown[]) => modelQuery(...args);
  },
}));

vi.mock("@warlock.js/seal", () => {
  const chained = () => {
    const proxy: Record<string, unknown> = {};
    const handler = () => proxy;

    for (const method of ["required", "optional", "extend", "default"]) {
      proxy[method] = handler;
    }

    return proxy;
  };

  return {
    v: { object: chained, string: chained, scalar: chained },
  };
});

import { UserRole } from "./user-role.model";

const user = { id: "u1", userType: "user" } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UserRole.rolesFor", () => {
  it("queries by user + tenant and returns the role names", async () => {
    const where = vi.fn(() => ({
      get: vi.fn().mockResolvedValue([{ get: () => "editor" }, { get: () => "viewer" }]),
    }));
    modelQuery.mockReturnValue({ where });

    const roles = await UserRole.rolesFor(user, "t1");

    expect(where).toHaveBeenCalledWith({ user_id: "u1", user_type: "user", tenant: "t1" });
    expect(roles).toEqual(["editor", "viewer"]);
  });

  it("scopes to the global (null) tenant when none is given — never the cross-tenant union", async () => {
    const where = vi.fn(() => ({ get: vi.fn().mockResolvedValue([]) }));
    modelQuery.mockReturnValue({ where });

    await UserRole.rolesFor(user);

    expect(where).toHaveBeenCalledWith({ user_id: "u1", user_type: "user", tenant: null });
  });

  it("de-dupes duplicate role rows", async () => {
    const where = vi.fn(() => ({
      get: vi.fn().mockResolvedValue([{ get: () => "editor" }, { get: () => "editor" }]),
    }));
    modelQuery.mockReturnValue({ where });

    expect(await UserRole.rolesFor(user, "t1")).toEqual(["editor"]);
  });
});

describe("UserRole.assign", () => {
  it("creates the assignment when it does not exist", async () => {
    modelFirst.mockResolvedValue(null);

    await UserRole.assign(user, "editor", "t1");

    expect(modelCreate).toHaveBeenCalledWith({
      user_id: "u1",
      user_type: "user",
      role: "editor",
      tenant: "t1",
    });
  });

  it("is a no-op when the assignment already exists", async () => {
    modelFirst.mockResolvedValue({ id: 1 });

    await UserRole.assign(user, "editor");

    expect(modelCreate).not.toHaveBeenCalled();
  });
});

describe("UserRole.revoke", () => {
  it("deletes the matching assignment", async () => {
    await UserRole.revoke(user, "editor", "t1");

    expect(modelDelete).toHaveBeenCalledWith({
      user_id: "u1",
      user_type: "user",
      role: "editor",
      tenant: "t1",
    });
  });
});
