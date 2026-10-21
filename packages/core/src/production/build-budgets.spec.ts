import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateBuildBudgets,
  formatBudgetViolations,
  formatBuildBudgets,
  parseBudgetSize,
  readBuildBudgetReport,
  writeBuildBudgetReport,
  type BudgetPage,
} from "./build-budgets";

const page: BudgetPage = {
  page: "/products/one",
  source: "src/web/product.page.tsx",
  js: 2048,
  css: 512,
  dynamic: { js: 100000, css: 0 },
  files: [],
  modules: [{ id: "editor.ts", bytes: 4000 }],
};

describe("build budgets", () => {
  it("reports without limits and sorts by combined transfer size", () => {
    const report = evaluateBuildBudgets([page, { ...page, page: "/", js: 4096 }]);
    expect(report.violations).toEqual([]);
    expect(report.pages.map((entry) => entry.page)).toEqual(["/", "/products/one"]);
  });
  it("applies route globs in insertion order, preserves defaults and permits equality", () => {
    const report = evaluateBuildBudgets([page], {
      page: { js: "1kb", css: "512b" },
      pages: { "/**": { js: "3kb" }, "/products/*": { js: "2kb" } },
    });
    expect(report.violations).toEqual([]);
    expect(
      evaluateBuildBudgets([page], { pages: { "/products/?ne": { js: "1kb" } } }).violations,
    ).toHaveLength(1);
  });
  it("names page, limit, actual and biggest modules, independently of enforcement mode", () => {
    for (const mode of ["warn", "error"] as const) {
      const report = evaluateBuildBudgets([page], { page: { js: "1kb" }, mode });
      const message = formatBudgetViolations(report);
      expect(message).toContain("/products/one");
      expect(message).toContain("budget 1.00kb, actual 2.00kb");
      expect(message).toContain("editor.ts (4000b)");
    }
  });
  it("compares stable route/source identities rather than hashed filenames", () => {
    const previous = evaluateBuildBudgets([{ ...page, js: 1024, css: 1024 }]);
    const report = evaluateBuildBudgets([page], undefined, previous);
    expect(report.pages[0]?.delta).toEqual({ js: 1024, css: -512 });
    expect(formatBuildBudgets(report)).toContain("+1.00kb");
    expect(formatBuildBudgets(report)).toContain("-0.50kb");
  });
  it("validates sizes and unmatched rules", () => {
    expect(parseBudgetSize("1.5MB")).toBe(1572864);
    for (const size of ["-1kb", "NaNkb", "1gb", "100", "Infinityb"])
      expect(() => parseBudgetSize(size)).toThrow("Invalid build budget");
    expect(() => evaluateBuildBudgets([], { pages: { "/unused": { js: "bad" } } })).toThrow();
    expect(() => evaluateBuildBudgets([], { pages: { "/[abc]": { js: "1kb" } } })).toThrow("glob");
  });
  it("stores a versioned baseline in dist and tolerates its absence", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "warlock-budgets-"));
    try {
      expect(await readBuildBudgetReport(directory)).toBeUndefined();
      const report = evaluateBuildBudgets([page]);
      await writeBuildBudgetReport(directory, report);
      expect(await readBuildBudgetReport(directory)).toEqual(report);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
