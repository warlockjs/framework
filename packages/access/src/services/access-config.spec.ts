import { afterEach, describe, expect, it } from "vitest";
import { accessConfig, resetAccessConfig, setAccessConfig } from "./access-config";
import { AccessConfigError } from "../utils/access-config-error";

const resolver = { resolveRoles: async () => [], resolvePermissions: async () => [] };
const user = { id: 1, userType: "user" } as never;

afterEach(() => {
  resetAccessConfig();
});

describe("setAccessConfig / accessConfig.resolver", () => {
  it("returns the resolver fed by setAccessConfig", () => {
    setAccessConfig({ resolver });

    expect(accessConfig.resolver()).toBe(resolver);
  });

  it("throws AccessConfigError when access was never configured", () => {
    expect(() => accessConfig.resolver()).toThrow(AccessConfigError);
  });

  it("throws AccessConfigError (at boot) when the config carries no resolver", () => {
    expect(() => setAccessConfig({} as never)).toThrow(AccessConfigError);
  });
});

describe("accessConfig.tenant", () => {
  it("delegates to the resolver's resolveTenant hook", () => {
    setAccessConfig({ resolver: { ...resolver, resolveTenant: () => "t-9" } });

    expect(accessConfig.tenant(user)).toBe("t-9");
  });

  it("returns undefined when the resolver has no resolveTenant", () => {
    setAccessConfig({ resolver });

    expect(accessConfig.tenant(user)).toBeUndefined();
  });
});

describe("accessConfig.strictPolicies", () => {
  it("defaults to true", () => {
    setAccessConfig({ resolver });

    expect(accessConfig.strictPolicies()).toBe(true);
  });

  it("reads the configured value when set", () => {
    setAccessConfig({ resolver, strictPolicies: false });

    expect(accessConfig.strictPolicies()).toBe(false);
  });
});

describe("accessConfig.cacheTtl", () => {
  it("defaults to 10m", () => {
    setAccessConfig({ resolver });

    expect(accessConfig.cacheTtl()).toBe("10m");
  });

  it("reads cache.ttl when set", () => {
    setAccessConfig({ resolver, cache: { ttl: "30m" } });

    expect(accessConfig.cacheTtl()).toBe("30m");
  });
});
