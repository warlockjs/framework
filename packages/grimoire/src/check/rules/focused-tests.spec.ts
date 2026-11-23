import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { snapshot } from "../../../tests/check/snapshot-builder";
import { checkFocusedTests } from "./focused-tests";

const root = mkdtempSync(path.join(tmpdir(), "grimoire-focused-"));
const files: Record<string, string> = {
  "src/app/shop/a.test.ts": 'it.only("a", () => {});\nit("b", () => {});\n',
  "src/app/shop/b.spec.ts": 'describe.skip("b", () => {});\nit.skipIf(true)("c", () => {});\n/* it.only("d") */\n',
  "src/app/shop/clean.test.ts": 'it("a", () => {});\n',
  "e2e/home.e2e.ts": 'test.only("home", async () => {});\n',
};

for (const [file, text] of Object.entries(files)) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("checkFocusedTests", () => {
  it("GR4011 for .only and GR4012 (a warning) for .skip, in the book's test files and the e2e folder", () => {
    const target = snapshot({ root });

    target.book.facts.tests = ["src/app/shop/a.test.ts", "src/app/shop/b.spec.ts", "src/app/shop/clean.test.ts"];
    target.book.manifest.files["e2e/home.e2e.ts"] = { hash: "", size: 0, mtimeMs: 0, entry: null };

    const findings = checkFocusedTests(target);

    expect(findings.map((finding) => `${finding.code} ${finding.severity} ${finding.at?.file}:${finding.at?.line}`)).toEqual([
      "GR4011 error e2e/home.e2e.ts:1",
      "GR4011 error src/app/shop/a.test.ts:1",
      "GR4012 warning src/app/shop/b.spec.ts:1",
    ]);
  });

  it("skips a test file that is gone", () => {
    const target = snapshot({ root });

    target.book.facts.tests = ["src/app/shop/missing.test.ts"];

    expect(checkFocusedTests(target)).toEqual([]);
  });
});
