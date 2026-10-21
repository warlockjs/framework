import { router } from "@warlock.js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveNamedApiRoutes } from "./named-api-routes";

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
