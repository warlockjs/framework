import { describe, expect, it } from "vitest";
import { matchesPermission } from "./matcher";

describe("matchesPermission", () => {
  it("matches an exact permission", () => {
    expect(matchesPermission(["orders.update"], "orders.update")).toBe(true);
  });

  it("rejects a different permission", () => {
    expect(matchesPermission(["orders.view"], "orders.update")).toBe(false);
  });

  it("treats `*` as the super-grant", () => {
    expect(matchesPermission(["*"], "anything.at.all")).toBe(true);
  });

  it("covers a nested permission with a prefix wildcard", () => {
    expect(matchesPermission(["orders.*"], "orders.update")).toBe(true);
    expect(matchesPermission(["orders.*"], "orders.update.status")).toBe(true);
  });

  it("does NOT let `orders.*` cover the bare `orders`", () => {
    expect(matchesPermission(["orders.*"], "orders")).toBe(false);
  });

  it("does NOT let one namespace's wildcard cover another", () => {
    expect(matchesPermission(["orders.*"], "posts.update")).toBe(false);
  });

  it("returns false for an empty grant set", () => {
    expect(matchesPermission([], "orders.update")).toBe(false);
  });

  it("matches when any pattern in the set covers the permission", () => {
    expect(matchesPermission(["posts.*", "orders.create"], "orders.create")).toBe(true);
  });

  it("does NOT let a prefix wildcard match a sibling namespace", () => {
    expect(matchesPermission(["orders.*"], "ordersX.update")).toBe(false);
  });

  it("a bare namespace grant covers nothing nested", () => {
    expect(matchesPermission(["orders"], "orders.update")).toBe(false);
  });

  it("handles empty inputs sanely", () => {
    expect(matchesPermission([""], "orders.update")).toBe(false);
    expect(matchesPermission(["orders.*"], "")).toBe(false);
  });
});
