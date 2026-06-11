import { beforeEach, describe, expect, it, vi } from "vitest";

const rolesFor = vi.fn();

vi.mock("../models/user-role.model", () => ({
  UserRole: { rolesFor: (...args: unknown[]) => rolesFor(...args) },
}));

import { ModelAccessResolver } from "./model-resolver";

const user = { id: "u1", userType: "user" } as never;
const roles = { editor: ["orders.*"], viewer: ["orders.view"] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ModelAccessResolver", () => {
  it("rolesOf delegates to the model with the tenant", async () => {
    rolesFor.mockResolvedValue(["editor"]);

    const resolver = new ModelAccessResolver(roles);

    expect(await resolver.rolesOf(user, "t1")).toEqual(["editor"]);
    expect(rolesFor).toHaveBeenCalledWith(user, "t1");
  });

  it("permissionsOf maps roles through the catalog", async () => {
    rolesFor.mockResolvedValue(["editor", "viewer"]);

    const resolver = new ModelAccessResolver(roles);

    expect(await resolver.permissionsOf(user)).toEqual(["orders.*", "orders.view"]);
  });

  it("ignores unknown roles", async () => {
    rolesFor.mockResolvedValue(["ghost"]);

    const resolver = new ModelAccessResolver(roles);

    expect(await resolver.permissionsOf(user)).toEqual([]);
  });
});
