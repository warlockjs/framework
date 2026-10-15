import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APP_ROLES,
  assertSitesRequireWebRole,
  getRoles,
  getSites,
  hasRole,
  parseRoles,
  parseSites,
  resetRolesCacheForTests,
  servesHttp,
} from "./roles";

describe("parseRoles", () => {
  it("defaults to every role when the value is undefined", () => {
    expect(parseRoles(undefined)).toEqual(new Set(APP_ROLES));
  });

  it("parses a single role", () => {
    expect(parseRoles("api")).toEqual(new Set(["api"]));
  });

  it("parses a combo of roles", () => {
    expect(parseRoles("web,api")).toEqual(new Set(["web", "api"]));
  });

  it("trims whitespace and lowercases", () => {
    expect(parseRoles(" Web , API ")).toEqual(new Set(["web", "api"]));
  });

  it("throws on an empty list", () => {
    expect(() => parseRoles("")).toThrow(/empty list/);
    expect(() => parseRoles(" , ")).toThrow(/empty list/);
  });

  it("throws on an unknown role, naming it and the valid values", () => {
    expect(() => parseRoles("api,bogus")).toThrow(/Unknown role "bogus"/);
    expect(() => parseRoles("bogus")).toThrow(/api, web, worker/);
  });
});

describe("parseSites", () => {
  it("returns undefined (all sites) when the value is undefined", () => {
    expect(parseSites(undefined)).toBeUndefined();
  });

  it("parses a list of site keys", () => {
    expect(parseSites("admin,storefront")).toEqual(new Set(["admin", "storefront"]));
  });

  it("throws on an empty list", () => {
    expect(() => parseSites("")).toThrow(/empty list/);
    expect(() => parseSites(" , ")).toThrow(/empty list/);
  });
});

describe("assertSitesRequireWebRole", () => {
  it("passes when sites is undefined regardless of roles", () => {
    expect(() => assertSitesRequireWebRole(new Set(["api"]), undefined)).not.toThrow();
  });

  it("passes when web is one of the active roles", () => {
    expect(() => assertSitesRequireWebRole(new Set(["web"]), new Set(["admin"]))).not.toThrow();
  });

  it("throws when sites is set without the web role", () => {
    expect(() => assertSitesRequireWebRole(new Set(["api"]), new Set(["admin"]))).toThrow(
      "--sites only applies to the web role",
    );
  });
});

describe("env-backed resolution (getRoles / getSites / hasRole / servesHttp)", () => {
  const originalRoles = process.env.WARLOCK_ROLES;
  const originalSites = process.env.WARLOCK_SITES;

  beforeEach(() => {
    resetRolesCacheForTests();
  });

  afterEach(() => {
    if (originalRoles === undefined) delete process.env.WARLOCK_ROLES;
    else process.env.WARLOCK_ROLES = originalRoles;

    if (originalSites === undefined) delete process.env.WARLOCK_SITES;
    else process.env.WARLOCK_SITES = originalSites;

    resetRolesCacheForTests();
  });

  it("defaults to every role and every site with no env set", () => {
    delete process.env.WARLOCK_ROLES;
    delete process.env.WARLOCK_SITES;

    expect(getRoles()).toEqual(new Set(APP_ROLES));
    expect(getSites()).toBeUndefined();
    expect(hasRole("worker")).toBe(true);
    expect(servesHttp()).toBe(true);
  });

  it("reads WARLOCK_ROLES/WARLOCK_SITES once and caches the result", () => {
    process.env.WARLOCK_ROLES = "worker";

    expect(getRoles()).toEqual(new Set(["worker"]));

    // Changing the env after the first read must not affect the cached value.
    process.env.WARLOCK_ROLES = "api";

    expect(getRoles()).toEqual(new Set(["worker"]));
  });

  it("resetRolesCacheForTests forces a re-read", () => {
    process.env.WARLOCK_ROLES = "worker";
    expect(getRoles()).toEqual(new Set(["worker"]));

    process.env.WARLOCK_ROLES = "api";
    resetRolesCacheForTests();

    expect(getRoles()).toEqual(new Set(["api"]));
  });

  it("servesHttp is false for a worker-only process, true for api/web", () => {
    process.env.WARLOCK_ROLES = "worker";
    expect(servesHttp()).toBe(false);

    resetRolesCacheForTests();
    process.env.WARLOCK_ROLES = "api";
    expect(servesHttp()).toBe(true);

    resetRolesCacheForTests();
    process.env.WARLOCK_ROLES = "web";
    expect(servesHttp()).toBe(true);
  });

  it("throws when WARLOCK_SITES is set without the web role in the active roles", () => {
    process.env.WARLOCK_ROLES = "api";
    process.env.WARLOCK_SITES = "admin";

    expect(() => getSites()).toThrow("--sites only applies to the web role");
  });
});
