import { describe, expect, it } from "vitest";
import { DefaultAccessResolver } from "./default-resolver";

function user(fields: Record<string, unknown>) {
  return { get: (key: string) => fields[key] } as never;
}

const roles = { editor: ["orders.*", "posts.create"], viewer: ["orders.view"] };

describe("DefaultAccessResolver", () => {
  it("reads a `roles` array column", async () => {
    const resolver = new DefaultAccessResolver(roles);

    expect(await resolver.resolveRoles(user({ roles: ["editor", "viewer"] }))).toEqual([
      "editor",
      "viewer",
    ]);
  });

  it("reads a single `role` string column", async () => {
    const resolver = new DefaultAccessResolver(roles);

    expect(await resolver.resolveRoles(user({ role: "editor" }))).toEqual(["editor"]);
  });

  it("returns no roles when neither field is present", async () => {
    const resolver = new DefaultAccessResolver(roles);

    expect(await resolver.resolveRoles(user({}))).toEqual([]);
  });

  it("maps roles to the union of their permissions", async () => {
    const resolver = new DefaultAccessResolver(roles);

    expect(await resolver.resolvePermissions(user({ roles: ["editor", "viewer"] }))).toEqual([
      "orders.*",
      "posts.create",
      "orders.view",
    ]);
  });

  it("ignores unknown roles when mapping permissions", async () => {
    const resolver = new DefaultAccessResolver(roles);

    expect(await resolver.resolvePermissions(user({ roles: ["ghost"] }))).toEqual([]);
  });

  it("honours a custom readRoles function", async () => {
    const resolver = new DefaultAccessResolver({ a: ["x"] }, (u) => u.get("memberRoles"));

    expect(await resolver.resolveRoles(user({ memberRoles: ["a"] }))).toEqual(["a"]);
  });
});
