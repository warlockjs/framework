import { describe, expect, it } from "vitest";
import { GrimoireError } from "../codes";
import { parseScryQuery } from "./parse";

function codeOf(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    return error instanceof GrimoireError ? error.code : "other";
  }

  return null;
}

describe("parseScryQuery", () => {
  it("passes --site with --route", () => {
    expect(parseScryQuery([], { route: "GET /chat", site: "admin" })).toEqual({
      type: "route",
      method: "GET",
      path: "/chat",
      site: "admin",
    });
    expect(() => parseScryQuery([], { route: "GET /chat", site: true })).toThrow(
      /--site needs a value/,
    );
  });

  it("reads every query form", () => {
    expect(parseScryQuery(["src/a.ts"], {})).toEqual({ type: "file", file: "src/a.ts" });
    expect(parseScryQuery([], { impact: "src/a.ts" })).toEqual({
      type: "impact",
      file: "src/a.ts",
    });
    expect(parseScryQuery([], { route: "post /api/orders" })).toEqual({
      type: "route",
      method: "POST",
      path: "/api/orders",
    });
    expect(parseScryQuery([], { feature: "catalog" })).toEqual({
      type: "feature",
      feature: "catalog",
    });
    expect(parseScryQuery([], { flow: "catalog/new-arrivals" })).toEqual({
      type: "flow",
      feature: "catalog",
      flow: "new-arrivals",
    });
    expect(parseScryQuery([], { search: "new arrivals" })).toEqual({
      type: "search",
      text: "new arrivals",
    });
    expect(parseScryQuery([], { search: "x", limit: "5" })).toEqual({
      type: "search",
      text: "x",
      limit: 5,
    });
    expect(parseScryQuery([], { search: "x", limit: 3, json: true })).toEqual({
      type: "search",
      text: "x",
      limit: 3,
    });
  });

  it("refuses no question, two questions and malformed values with GR9006", () => {
    expect(codeOf(() => parseScryQuery([], {}))).toBe("GR9006");
    expect(codeOf(() => parseScryQuery([], { json: true }))).toBe("GR9006");
    expect(codeOf(() => parseScryQuery(["src/a.ts"], { feature: "catalog" }))).toBe("GR9006");
    expect(codeOf(() => parseScryQuery(["a.ts", "b.ts"], {}))).toBe("GR9006");
    expect(codeOf(() => parseScryQuery([], { route: "/api/orders" }))).toBe("GR9006");
    expect(codeOf(() => parseScryQuery([], { flow: "catalog" }))).toBe("GR9006");
    expect(codeOf(() => parseScryQuery([], { flow: "Catalog/new arrivals" }))).toBe("GR9006");
    expect(codeOf(() => parseScryQuery([], { feature: "Catalog!" }))).toBe("GR9006");
    expect(codeOf(() => parseScryQuery([], { impact: true }))).toBe("GR9006");
    expect(codeOf(() => parseScryQuery([], { search: "x", limit: "0" }))).toBe("GR9006");
    expect(codeOf(() => parseScryQuery([], { search: "x", limit: "two" }))).toBe("GR9006");
  });

  it("says what to pass", () => {
    expect(() => parseScryQuery([], { route: "orders" })).toThrow(/"<METHOD> <path>"/);
  });
});
