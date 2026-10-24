import { router } from "@warlock.js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isUnderPrivatePrefix, resolveNamedApiRoutes } from "./named-api-routes";

const REGISTERED = [
  { name: "orders.show", path: "/api/orders/:id", method: "GET" as const },
  { name: "admin.purge", path: "/api/admin/purge", method: "POST" as const },
  {
    name: "internal.reindex",
    path: "/internal/reindex",
    method: "POST" as const,
    clientVisible: false as const,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveNamedApiRoutes", () => {
  it("embeds only the requested names", () => {
    vi.spyOn(router, "getNamedApiRoutes").mockReturnValue(REGISTERED);

    expect(resolveNamedApiRoutes(["orders.show"])).toEqual({
      "orders.show": { path: "/api/orders/:id", method: "GET" },
    });
  });

  it("never embeds a route that opted out of the browser, even when a page asks for it", () => {
    vi.spyOn(router, "getNamedApiRoutes").mockReturnValue(REGISTERED);

    const table = resolveNamedApiRoutes(["internal.reindex", "admin.purge"]);

    expect(table).toEqual({ "admin.purge": { path: "/api/admin/purge", method: "POST" } });
    expect(JSON.stringify(table)).not.toContain("/internal/reindex");
  });

  it("answers an empty table when no names are asked for, never the whole registry", () => {
    vi.spyOn(router, "getNamedApiRoutes").mockReturnValue(REGISTERED);

    expect(resolveNamedApiRoutes()).toEqual({});
    expect(resolveNamedApiRoutes([])).toEqual({});
  });

  it("ignores a requested name that is not registered", () => {
    vi.spyOn(router, "getNamedApiRoutes").mockReturnValue(REGISTERED);

    expect(resolveNamedApiRoutes(["missing.route"])).toEqual({});
  });

  it("answers undefined when the registry cannot be read, so the browser reports it", () => {
    vi.spyOn(router, "getNamedApiRoutes").mockImplementation(() => {
      throw new Error("registry unavailable");
    });

    expect(resolveNamedApiRoutes(["orders.show"])).toBeUndefined();
  });
});

describe("web.namedApiRoutes", () => {
  const TABLE = [
    { name: "orders.show", path: "/api/orders/:id", method: "GET" as const },
    { name: "orders.list", path: "/api/orders", method: "GET" as const },
    { name: "admin.users.create", path: "/api/admin/users", method: "POST" as const },
    { name: "hooks.stripe", path: "/api/webhooks/stripe", method: "POST" as const },
    { name: "admin.stats", path: "/api/stats", method: "GET" as const, sites: ["admin"] },
    { name: "shop.cart", path: "/api/cart", method: "GET" as const, sites: ["shop", "admin"] },
    {
      name: "account.update",
      path: "/api/account",
      method: "PATCH" as const,
      guarded: true as const,
    },
  ];
  const ALL = TABLE.map((route) => route.name);

  const names = (table: ReturnType<typeof resolveNamedApiRoutes>) =>
    Object.keys(table ?? {}).sort();

  it("embeds nothing when it is false", () => {
    vi.spyOn(router, "getNamedApiRoutes").mockReturnValue(TABLE);

    expect(resolveNamedApiRoutes(ALL, { config: false })).toBeUndefined();
  });

  it("narrows the table to an allowlist of names and prefix patterns", () => {
    vi.spyOn(router, "getNamedApiRoutes").mockReturnValue(TABLE);

    expect(names(resolveNamedApiRoutes(ALL, { config: ["orders.*", "shop.cart"] }))).toEqual([
      "orders.list",
      "orders.show",
      "shop.cart",
    ]);
    expect(names(resolveNamedApiRoutes(ALL, { config: { include: ["orders.show"] } }))).toEqual([
      "orders.show",
    ]);
  });

  it("asks a filter with the route, the site and whether the viewer is a guest", () => {
    vi.spyOn(router, "getNamedApiRoutes").mockReturnValue(TABLE);
    const seen: unknown[] = [];
    const filter = vi.fn((route: { name: string }, context: unknown) => {
      seen.push(context);
      return route.name === "orders.list";
    });

    const table = resolveNamedApiRoutes(ALL, { config: filter, site: "shop", guest: false });

    expect(names(table)).toEqual(["orders.list"]);
    expect(seen[0]).toEqual({ site: "shop", guest: false });
    expect(filter).toHaveBeenCalledWith(
      {
        name: "orders.show",
        path: "/api/orders/:id",
        method: "GET",
        sites: undefined,
        guarded: false,
      },
      { site: "shop", guest: false },
    );
  });

  it("lets a throwing filter surface instead of shipping a wrong table", () => {
    vi.spyOn(router, "getNamedApiRoutes").mockReturnValue(TABLE);

    expect(() =>
      resolveNamedApiRoutes(ALL, {
        config: () => {
          throw new Error("bad filter");
        },
      }),
    ).toThrow("bad filter");
  });

  it("never embeds a route under a private prefix, for any viewer or site", () => {
    vi.spyOn(router, "getNamedApiRoutes").mockReturnValue(TABLE);
    const config = { privatePrefixes: ["/api/admin/", "/api/webhooks"] };

    for (const guest of [true, false]) {
      const table = resolveNamedApiRoutes(ALL, { config, guest, site: "admin" });

      expect(names(table)).not.toContain("admin.users.create");
      expect(names(table)).not.toContain("hooks.stripe");
      expect(names(table)).toContain("orders.show");
    }
  });

  it("matches a private prefix by whole path segments", () => {
    expect(isUnderPrivatePrefix("/api/admin/users", "/api/admin/")).toBe(true);
    expect(isUnderPrivatePrefix("/api/admin", "/api/admin")).toBe(true);
    expect(isUnderPrivatePrefix("/api/administrators", "/api/admin")).toBe(false);
    expect(isUnderPrivatePrefix("/api/orders", "/api/admin/")).toBe(false);
  });

  it("scopes the table to the serving site and keeps shared routes", () => {
    vi.spyOn(router, "getNamedApiRoutes").mockReturnValue(TABLE);

    expect(names(resolveNamedApiRoutes(ALL, { site: "shop" }))).toEqual([
      "account.update",
      "admin.users.create",
      "hooks.stripe",
      "orders.list",
      "orders.show",
      "shop.cart",
    ]);
    expect(names(resolveNamedApiRoutes(ALL, { site: "admin" }))).toContain("admin.stats");
    expect(names(resolveNamedApiRoutes(ALL))).toContain("admin.stats");
  });

  it("drops guarded routes only for a known guest; an unknown viewer keeps them", () => {
    vi.spyOn(router, "getNamedApiRoutes").mockReturnValue(TABLE);

    expect(names(resolveNamedApiRoutes(ALL, { guest: true }))).not.toContain("account.update");
    expect(names(resolveNamedApiRoutes(ALL, { guest: false }))).toContain("account.update");
    expect(names(resolveNamedApiRoutes(ALL))).toContain("account.update");
  });
});
