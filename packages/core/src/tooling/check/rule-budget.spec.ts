import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientBoundaryProblems, createClientBoundaryCache } from "./client-boundary-conventions";
import { readConventionOptions, runConventions } from "./conventions-step";
import { runCheck } from "./run-check";
import { createRuleBudget, withinBudget } from "./rule-budget";
import { listSourceFiles } from "./source-files";
import * as ast from "../syntax/ast";

let root: string;

function write(relative: string, source = "export {};\n"): void {
  const file = path.join(root, relative);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
}

function busyWait(milliseconds: number): void {
  const end = performance.now() + milliseconds;

  while (performance.now() < end) {
    // Spin: the budget measures wall-clock time.
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "warlock-budget-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("withinBudget", () => {
  it("skips a rule once its total time is over the budget", () => {
    const exceeded: string[] = [];
    const budget = createRuleBudget(5, (rule) => exceeded.push(rule));
    let runs = 0;
    const slow = () => {
      runs++;
      busyWait(8);

      return "ran";
    };

    expect(withinBudget(budget, "slow", "skipped", slow)).toBe("ran");
    expect(withinBudget(budget, "slow", "skipped", slow)).toBe("skipped");
    expect(withinBudget(budget, "slow", "skipped", slow)).toBe("skipped");
    expect(runs).toBe(1);
    expect(exceeded).toEqual(["slow"]);
    expect(budget.exhausted.get("slow")).toEqual({ skippedFiles: 2 });
    expect(withinBudget(budget, "other", "skipped", () => "ran")).toBe("ran");
  });

  it("never skips when the budget is 0", () => {
    const budget = createRuleBudget(0);

    expect(withinBudget(budget, "slow", "skipped", () => "ran")).toBe("ran");
    expect(withinBudget(budget, "slow", "skipped", () => "ran")).toBe("ran");
    expect(budget.exhausted.size).toBe(0);
  });
});

describe("runConventions budget and progress", () => {
  it("reports a rule over budget as a WL9026 warning and narrates the run", () => {
    write("src/app/posts/a.ts");
    write("src/app/posts/b.ts");
    write("src/app/posts/c.ts");

    const lines: string[] = [];
    const problems = runConventions(
      root,
      ["src/app/posts/a.ts", "src/app/posts/b.ts", "src/app/posts/c.ts"],
      undefined,
      undefined,
      undefined,
      { onProgress: (line) => lines.push(line), ruleBudgetMs: 0.0001 },
    );
    const budgetProblems = problems.filter((problem) => problem.code === "WL9026");

    expect(budgetProblems.length).toBeGreaterThan(0);
    expect(budgetProblems[0]).toMatchObject({ severity: "warning", source: "convention" });
    expect(budgetProblems[0]?.message).toMatch(/^Rule "WL\d{4}[^"]*" used \d+\.\ds, over its/);
    expect(lines[0]).toContain("collecting project facts for 3 file(s)");
    expect(lines.some((line) => line.includes("over its"))).toBe(true);
    expect(lines.at(-1)).toMatch(/^conventions: done in .*slowest rule/);
  });

  it("reports nothing with the default budget on a small project", () => {
    write("src/app/posts/a.ts");

    const problems = runConventions(root, ["src/app/posts/a.ts"]);

    expect(problems.filter((problem) => problem.code === "WL9026")).toEqual([]);
  });

  it("reads ruleBudgetMs from .warlock-check.json and rejects a bad value", () => {
    write(".warlock-check.json", JSON.stringify({ ruleBudgetMs: 1234 }));
    expect(readConventionOptions(root).ruleBudgetMs).toBe(1234);

    write(".warlock-check.json", JSON.stringify({ ruleBudgetMs: -1 }));
    expect(() => readConventionOptions(root)).toThrow("ruleBudgetMs");
  });
});

describe("runCheck progress", () => {
  it("prints a line when each step starts and ends", async () => {
    write("package.json", JSON.stringify({ name: "shop" }));
    write("src/app/posts/a.ts");

    const lines: string[] = [];

    await runCheck({
      cwd: root,
      skip: ["typecheck", "lint", "tests"],
      nodeVersion: "22.15.0",
      onProgress: (line) => lines.push(line),
    });

    expect(lines).toContain("environment: running");
    expect(lines.some((line) => /^environment: passed in \d+\.\ds/.test(line))).toBe(true);
    expect(lines).toContain("conventions: running");
    expect(lines.some((line) => /^conventions: passed in \d+\.\ds/.test(line))).toBe(true);
  });
});

describe("WL9022 on a large import graph", () => {
  it("walks shared files once, not once per server-only file", async () => {
    const shared = 300;
    const servers = 300;

    for (let index = 0; index < shared; index++) {
      const imports = [1, 2, 3]
        .filter((back) => index - back >= 0)
        .map((back) => `import { v${index - back} } from "./u${index - back}";`);

      write(
        `src/shared/u${index}.ts`,
        `${imports.join("\n")}\nexport const v${index} = ${index};\n`,
      );
    }

    for (let index = 0; index < servers; index++) {
      const target = shared - 1 - (index % 5);

      write(
        `src/app/m${index % 20}/services/s${index}.service.ts`,
        `import { v${target} } from "../../../shared/u${target}";\nexport const s${index} = v${target};\n`,
      );
    }

    write("src/shared/u0.ts", 'import "./ui.client";\nexport const v0 = 0;\n');
    write("src/shared/ui.client.ts");

    const files = (await listSourceFiles(root)).filter((file) => file.endsWith(".service.ts"));
    const cache = createClientBoundaryCache();
    const startedAt = performance.now();
    let found = 0;

    for (const file of files) {
      const text = readFileSync(path.join(root, file), "utf8");

      found += clientBoundaryProblems(ast.parseSourceFile(file, text), file, root, cache).length;
    }

    const elapsed = performance.now() - startedAt;

    // Every service reaches the client module through the shared chain.
    expect(found).toBe(servers);
    // Each shared file was read once. Before the cache this took tens of seconds.
    expect(cache.imports.size).toBeLessThanOrEqual(shared + 1);
    expect(elapsed).toBeLessThan(5000);
  });

  it("remembers files that reach no client module", async () => {
    write("src/shared/a.ts", 'import "./b";\n');
    write("src/shared/b.ts");
    write("src/app/posts/services/one.service.ts", 'import "../../../shared/a";\n');

    const cache = createClientBoundaryCache();
    const file = "src/app/posts/services/one.service.ts";
    const source = ast.parseSourceFile(file, 'import "../../../shared/a";\n');

    expect(clientBoundaryProblems(source, file, root, cache)).toEqual([]);
    expect([...cache.dead].sort()).toEqual(["src/shared/a.ts", "src/shared/b.ts"]);
  });
});
