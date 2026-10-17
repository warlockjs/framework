import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unifiedDiff } from "./unified-diff";

const lines = (count: number, prefix = "line") =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);

/** Apply a diff with `git apply` in a scratch repo and return the result, proving the format. */
function applyWithGit(file: string, before: string | null, diff: string): string | null {
  const directory = mkdtempSync(path.join(os.tmpdir(), "warlock-diff-"));

  try {
    if (before !== null) {
      mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      writeFileSync(path.join(directory, file), before);
    }

    writeFileSync(path.join(directory, "change.patch"), diff);
    execFileSync("git", ["apply", "change.patch"], { cwd: directory, stdio: "pipe" });

    try {
      return readFileSync(path.join(directory, file), "utf8");
    } catch {
      return null;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("unifiedDiff", () => {
  it("returns an empty string for identical content", () => {
    expect(unifiedDiff({ path: "a.ts", before: "same\n", after: "same\n" })).toBe("");
  });

  it("diffs a created file against /dev/null", () => {
    const diff = unifiedDiff({ path: "src/app/x.ts", before: null, after: "one\ntwo\n" });

    expect(diff).toBe(
      ["--- /dev/null", "+++ b/src/app/x.ts", "@@ -0,0 +1,2 @@", "+one", "+two", ""].join("\n"),
    );
    expect(applyWithGit("src/app/x.ts", null, diff)).toBe("one\ntwo\n");
  });

  it("diffs a deleted file to /dev/null", () => {
    const diff = unifiedDiff({ path: "old.ts", before: "gone\n", after: null });

    expect(diff).toBe(["--- a/old.ts", "+++ /dev/null", "@@ -1,1 +0,0 @@", "-gone", ""].join("\n"));
    expect(applyWithGit("old.ts", "gone\n", diff)).toBeNull();
  });

  it("keeps three lines of context and splits distant changes into hunks", () => {
    const before = `${lines(20).join("\n")}\n`;
    const changed = lines(20);

    changed[1] = "changed 2";
    changed[17] = "changed 18";

    const after = `${changed.join("\n")}\n`;
    const diff = unifiedDiff({ path: "routes.ts", before, after });

    expect(diff.match(/^@@/gm)).toHaveLength(2);
    expect(diff).toContain(
      "@@ -1,5 +1,5 @@\n line 1\n-line 2\n+changed 2\n line 3\n line 4\n line 5\n",
    );
    expect(diff).toContain(
      "@@ -15,6 +15,6 @@\n line 15\n line 16\n line 17\n-line 18\n+changed 18\n",
    );
    expect(applyWithGit("routes.ts", before, diff)).toBe(after);
  });

  it("merges changes whose context overlaps into one hunk", () => {
    const before = `${lines(10).join("\n")}\n`;
    const changed = lines(10);

    changed[2] = "x";
    changed[6] = "y";

    const diff = unifiedDiff({ path: "a.ts", before, after: `${changed.join("\n")}\n` });

    expect(diff.match(/^@@/gm)).toHaveLength(1);
  });

  it("handles inserts in the middle", () => {
    const before = "import a;\nimport b;\n\nexport {};\n";
    const after = "import a;\nimport b;\nimport c;\n\nexport {};\n";
    const diff = unifiedDiff({ path: "main.ts", before, after });

    expect(diff).toContain("+import c;");
    expect(diff).not.toContain("-import");
    expect(applyWithGit("main.ts", before, diff)).toBe(after);
  });

  it("marks a missing final newline", () => {
    const diff = unifiedDiff({ path: "a.json", before: '{"a":1}', after: '{"a":2}\n' });

    expect(diff).toContain('-{"a":1}\n\\ No newline at end of file\n+{"a":2}\n');
    expect(applyWithGit("a.json", '{"a":1}', diff)).toBe('{"a":2}\n');
  });
});
