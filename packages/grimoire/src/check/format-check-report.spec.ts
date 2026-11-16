import { describe, expect, it } from "vitest";
import { createFinding } from "../codes";
import type { GrimoireCheckReport } from "../contracts";
import { formatCheckReport } from "./format-check-report";

function report(patch: Partial<GrimoireCheckReport>): GrimoireCheckReport {
  return {
    schemaVersion: 1,
    root: "/project",
    findings: [],
    counts: { errors: 0, warnings: 0, expected: 0 },
    ok: true,
    routes: "fresh",
    ...patch,
  };
}

describe("formatCheckReport", () => {
  it("prints one line per finding, a fix under unexpected errors, and the counts", () => {
    const expected = {
      ...createFinding({
        code: "GR2001",
        message: 'route step "POST /api/wishlist" matches no route',
        at: { file: "grimoire/features/catalog/flows/wishlist.md", line: 12, column: null },
      }),
      expected: true,
    };

    expect(
      formatCheckReport(
        report({
          findings: [
            createFinding({
              code: "GR3004",
              message: "src/a.ts is tagged @feature x, which is no feature",
              at: { file: "src/a.ts", line: 1, column: 4 },
            }),
            createFinding({
              code: "GR4001",
              message: "catalog/browse-products AC-1 has no test",
              at: {
                file: "grimoire/features/catalog/flows/browse-products.md",
                line: 26,
                column: null,
              },
            }),
            createFinding({ code: "GR8003", message: "route facts are stale" }),
            expected,
          ],
          counts: { errors: 1, warnings: 2, expected: 1 },
          ok: false,
          routes: "stale",
        }),
      ),
    ).toEqual([
      "src/a.ts:1  GR3004  error  src/a.ts is tagged @feature x, which is no feature",
      "    fix: Fix the tag, or write the feature.",
      "grimoire/features/catalog/flows/browse-products.md:26  GR4001  warning  catalog/browse-products AC-1 has no test",
      "-  GR8003  warning  route facts are stale",
      'grimoire/features/catalog/flows/wishlist.md:12  GR2001  error  route step "POST /api/wishlist" matches no route  (expected)',
      "1 error, 2 warnings, 1 expected  (routes: stale)",
    ]);
  });

  it("prints only the counts for a clean report", () => {
    expect(formatCheckReport(report({}))).toEqual([
      "0 errors, 0 warnings, 0 expected  (routes: fresh)",
    ]);
  });

  describe("many warnings", () => {
    const many = (code: "GR3001" | "GR3002", count: number) =>
      Array.from({ length: count }, (_, index) =>
        createFinding({
          code,
          message: `warning ${index}`,
          at: { file: `src/f${index}.ts`, line: 1, column: null },
        }),
      );
    const bulk = report({
      findings: [
        createFinding({
          code: "GR2001",
          message: "broken",
          at: { file: "a.md", line: 2, column: null },
        }),
        ...many("GR3001", 12),
        ...many("GR3002", 3),
      ],
      counts: { errors: 1, warnings: 15, expected: 0 },
      ok: false,
    });

    it("keeps errors in full and shows the first five warnings of a code with a count", () => {
      const lines = formatCheckReport(bulk);

      expect(lines.filter((line) => line.includes("GR3001"))).toHaveLength(6);
      expect(lines.filter((line) => line.includes("GR3002"))).toHaveLength(3);
      expect(lines.some((line) => line.includes("GR2001  error  broken"))).toBe(true);
      expect(lines).toContain("    … GR3001: 12 findings in all, 7 not shown");
      expect(lines).toContain("7 findings not listed; run with --all to list every finding.");
      expect(lines.at(-1)).toBe("1 error, 15 warnings, 0 expected  (routes: fresh)");
    });

    it("lists everything with all", () => {
      const lines = formatCheckReport(bulk, { all: true });

      expect(lines.filter((line) => line.includes("GR3001"))).toHaveLength(12);
      expect(lines.some((line) => line.includes("run with --all"))).toBe(false);
    });
  });
});
