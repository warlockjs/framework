import { beforeEach, describe, expect, it, vi } from "vitest";

const configValues: Record<string, unknown> = {};

vi.mock("@warlock.js/core", () => ({
  config: {
    key: (path: string, fallback?: unknown) =>
      path in configValues ? configValues[path] : fallback,
  },
}));

import { accessConfig, resetAccessConfig } from "./access-config";
import { DefaultAccessResolver } from "./default-resolver";

beforeEach(() => {
  for (const key of Object.keys(configValues)) delete configValues[key];
  resetAccessConfig();
});

describe("accessConfig.resolver", () => {
  it("returns the configured resolver when one is set", () => {
    const custom = { rolesOf: async () => [], permissionsOf: async () => [] };
    configValues["access.resolver"] = custom;

    expect(accessConfig.resolver()).toBe(custom);
  });

  it("falls back to a memoised DefaultAccessResolver", () => {
    configValues["access.roles"] = { editor: ["orders.*"] };

    const first = accessConfig.resolver();
    const second = accessConfig.resolver();

    expect(first).toBeInstanceOf(DefaultAccessResolver);
    expect(second).toBe(first);
  });

  it("resetAccessConfig forces a rebuild of the default", () => {
    const first = accessConfig.resolver();

    resetAccessConfig();

    expect(accessConfig.resolver()).not.toBe(first);
  });
});

describe("accessConfig.tenant", () => {
  it("returns the hook value when configured", () => {
    configValues["access.tenant.resolve"] = () => "t-9";

    expect(accessConfig.tenant()).toBe("t-9");
  });

  it("returns undefined when no hook is set", () => {
    expect(accessConfig.tenant()).toBeUndefined();
  });
});

describe("accessConfig.cacheTtl", () => {
  it("defaults to 10m", () => {
    expect(accessConfig.cacheTtl()).toBe("10m");
  });
});
