import { afterEach, describe, expect, it } from "vitest";
import { clearPolicies, definePolicy, getPolicy } from "./policies";

afterEach(() => {
  clearPolicies();
});

describe("policies registry", () => {
  it("returns a registered policy", () => {
    const policy = () => true;

    definePolicy("orders.update", policy);

    expect(getPolicy("orders.update")).toBe(policy);
  });

  it("returns undefined for an unregistered permission", () => {
    expect(getPolicy("orders.update")).toBeUndefined();
  });

  it("overwrites a policy on redefine", () => {
    const first = () => true;
    const second = () => false;

    definePolicy("orders.update", first);
    definePolicy("orders.update", second);

    expect(getPolicy("orders.update")).toBe(second);
  });

  it("clears every policy", () => {
    definePolicy("orders.update", () => true);

    clearPolicies();

    expect(getPolicy("orders.update")).toBeUndefined();
  });
});
