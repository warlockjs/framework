import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCheck } from "./run-check";

let root: string;

function write(relative: string, source = "export {};\n"): void {
  const file = path.join(root, relative);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "warlock-budget-report-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the report when a rule is skipped", () => {
  it("lists the WL9026 warning in the report problems and keeps the run passing", async () => {
    write("package.json", JSON.stringify({ name: "shop" }));
    write("src/app/posts/a.ts");
    write("src/app/posts/b.ts");

    const report = await runCheck({
      cwd: root,
      skip: ["typecheck", "lint", "tests"],
      nodeVersion: "22.15.0",
      ruleBudgetMs: 0.0001,
    });
    const skipped = report.problems.filter((problem) => problem.code === "WL9026");
    const printed = JSON.parse(JSON.stringify(report)) as { problems: { code: string }[] };

    // Problems are on the report, not on its steps.
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0]).toMatchObject({ severity: "warning", source: "convention" });
    expect(printed.problems.some((problem) => problem.code === "WL9026")).toBe(true);
    expect(report.summary.warnings).toBeGreaterThanOrEqual(skipped.length);
    expect(report.ok).toBe(true);
  });
});
