import { describe, expect, it } from "vitest";
import {
  formatRoutesTableLines,
  routesSummary,
} from "../../../../src/cli/commands/routes/format-routes-table";
import type { RouteRow } from "../../../../src/cli/commands/routes/route-row";

const HEADERS = ["METHOD", "PATH", "NAME", "ACTION", "MW", "SOURCE"];

const rows: RouteRow[] = [
  {
    method: "GET",
    path: "/users",
    name: "users.list",
    action: "index",
    middleware: 2,
    source: "app/users/routes.ts",
  },
  {
    method: "POST",
    path: "/users",
    name: "users.create",
    action: "store",
    middleware: 2,
    source: "app/users/routes.ts",
  },
  {
    method: "DELETE",
    path: "/users/:id",
    name: "users.delete",
    action: "destroy",
    middleware: 3,
    source: "app/users/routes.ts",
  },
];

describe("formatRoutesTableLines", () => {
  it("renders a header row, one line per route, a blank spacer and a summary", () => {
    const lines = formatRoutesTableLines(rows);

    // header + 3 rows + blank + summary
    expect(lines).toHaveLength(rows.length + 3);
    expect(lines[lines.length - 2]).toBe("");
    expect(lines[lines.length - 1]).toBe(routesSummary(rows));
  });

  it("emits every column header, in order, in the first line", () => {
    const header = formatRoutesTableLines(rows)[0];
    expect(header.split(/\s{2,}/)).toEqual(HEADERS);
  });

  it("renders a data row as aligned, two-space-separated cells", () => {
    const line = formatRoutesTableLines(rows)[1];
    expect(line.split(/\s{2,}/)).toEqual([
      "GET",
      "/users",
      "users.list",
      "index",
      "2",
      "app/users/routes.ts",
    ]);
  });

  it("aligns columns: the header and each row pad to the same widths", () => {
    const lines = formatRoutesTableLines(rows);
    const dataLines = lines.slice(1, 1 + rows.length);

    // The PATH column starts at the same character offset on every printed row.
    const pathStart = lines[0].indexOf("PATH");
    for (const line of dataLines) {
      expect(line.slice(pathStart).startsWith("/")).toBe(true);
    }
  });

  it("shows an em-dash for an empty cell", () => {
    const line = formatRoutesTableLines([
      { method: "GET", path: "/", name: "", action: "", middleware: 0, source: "" },
    ])[1];
    // name, action, source are empty → rendered as "—"
    expect(line.split(/\s{2,}/)).toEqual(["GET", "/", "—", "—", "0", "—"]);
  });

  it("returns a single notice for an empty route set", () => {
    expect(formatRoutesTableLines([])).toEqual(["No routes registered."]);
  });
});

describe("routesSummary", () => {
  it("totals the routes with a per-method breakdown ordered by HTTP-method", () => {
    expect(routesSummary(rows)).toBe("3 routes (1 GET · 1 POST · 1 DELETE)");
  });

  it("uses the singular noun for one route", () => {
    expect(routesSummary([rows[0]])).toBe("1 route (1 GET)");
  });

  it("reports zero routes", () => {
    expect(routesSummary([])).toBe("0 routes");
  });
});
