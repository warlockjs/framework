import { describe, expect, it } from "vitest";
import type { Route } from "../../../../src/router/types";
import {
  filterRouteRows,
  sortRouteRows,
  toRouteRow,
  type RouteRow,
} from "../../../../src/cli/commands/routes/route-row";

/**
 * Build a minimal {@link Route} for normalization tests. Only the fields
 * `toRouteRow` reads are populated; the rest are cast away.
 */
function route(partial: Partial<Route>): Route {
  return {
    method: "GET",
    path: "/",
    handler: function handler() {},
    sourceFile: "",
    $prefix: "",
    $prefixStack: [],
    ...partial,
  } as Route;
}

/** A function with an empty `name` — the truly-anonymous handler case. */
function anonymousHandler() {}
Object.defineProperty(anonymousHandler, "name", { value: "" });

describe("toRouteRow", () => {
  it("uppercases the method and copies the scalar fields", () => {
    const row = toRouteRow(
      route({
        method: "POST",
        path: "/users",
        name: "users.create",
        handler: function store() {},
        middleware: [() => {}, () => {}] as unknown as Route["middleware"],
        sourceFile: "app/users/routes.ts",
      }),
    );

    expect(row).toEqual<RouteRow>({
      method: "POST",
      path: "/users",
      name: "users.create",
      action: "store",
      middleware: 2,
      source: "app/users/routes.ts",
    });
  });

  it("maps the `all` verb to ALL", () => {
    expect(toRouteRow(route({ method: "all" })).method).toBe("ALL");
  });

  it("strips the `bound ` prefix from a bound handler name", () => {
    const bound = function show() {}.bind(null);
    expect(bound.name).toBe("bound show");
    expect(toRouteRow(route({ handler: bound })).action).toBe("show");
  });

  it("falls back to `anonymous` for an unnamed handler", () => {
    expect(toRouteRow(route({ handler: anonymousHandler })).action).toBe("anonymous");
  });

  it("defaults a missing name / middleware / source to empty / zero", () => {
    const row = toRouteRow(route({ name: undefined, middleware: undefined, sourceFile: "" }));

    expect(row.name).toBe("");
    expect(row.middleware).toBe(0);
    expect(row.source).toBe("");
  });
});

describe("filterRouteRows", () => {
  const rows: RouteRow[] = [
    { method: "GET", path: "/users", name: "users.list", action: "index", middleware: 1, source: "a" },
    { method: "POST", path: "/users", name: "users.create", action: "store", middleware: 2, source: "a" },
    { method: "GET", path: "/posts", name: "posts.list", action: "index", middleware: 0, source: "b" },
  ];

  it("matches everything when no filter is given", () => {
    expect(filterRouteRows(rows, {})).toHaveLength(3);
  });

  it("filters by exact method, case-insensitively", () => {
    const got = filterRouteRows(rows, { method: "get" });
    expect(got.map((r) => r.path)).toEqual(["/users", "/posts"]);
  });

  it("filters by a case-insensitive path substring", () => {
    expect(filterRouteRows(rows, { path: "USER" }).every((r) => r.path === "/users")).toBe(true);
  });

  it("filters by a case-insensitive name substring", () => {
    const got = filterRouteRows(rows, { name: "create" });
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("users.create");
  });

  it("AND-s multiple filters together", () => {
    const got = filterRouteRows(rows, { method: "GET", path: "/users" });
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("users.list");
  });
});

describe("sortRouteRows", () => {
  it("sorts by path, then by HTTP-method order within a path", () => {
    const rows: RouteRow[] = [
      { method: "POST", path: "/users", name: "", action: "", middleware: 0, source: "" },
      { method: "GET", path: "/posts", name: "", action: "", middleware: 0, source: "" },
      { method: "GET", path: "/users", name: "", action: "", middleware: 0, source: "" },
      { method: "DELETE", path: "/users", name: "", action: "", middleware: 0, source: "" },
    ];

    expect(sortRouteRows(rows).map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /posts",
      "GET /users",
      "POST /users",
      "DELETE /users",
    ]);
  });

  it("does not mutate the input array", () => {
    const rows: RouteRow[] = [
      { method: "POST", path: "/b", name: "", action: "", middleware: 0, source: "" },
      { method: "GET", path: "/a", name: "", action: "", middleware: 0, source: "" },
    ];
    const snapshot = [...rows];
    sortRouteRows(rows);
    expect(rows).toEqual(snapshot);
  });
});
