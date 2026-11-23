/**
 * GR4011, GR4012: tests focused with `.only` or skipped with `.skip`, in
 * every test file the book knows. `.skipIf(...)` is not flagged.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createFinding } from "../../codes";
import type { GrimoireFinding } from "../../contracts/findings";
import type { GrimoireSnapshot } from "../../contracts/snapshot";
import { isTestPath } from "../../guard/rules";
import { findFocusedTests } from "../../rules/focused";

export function checkFocusedTests(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const findings: GrimoireFinding[] = [];
  const files = new Set(snapshot.book.facts.tests);

  for (const file of Object.keys(snapshot.book.manifest.files)) {
    if (/\.[cm]?[jt]sx?$/.test(file) && isTestPath(file) && !file.includes("node_modules/")) files.add(file);
  }

  for (const file of [...files].sort()) {
    let text: string;

    try {
      text = readFileSync(path.join(snapshot.root, ...file.split("/")), "utf8");
    } catch {
      continue;
    }

    for (const hit of findFocusedTests(text)) {
      findings.push(
        createFinding({
          code: hit.type === "only" ? "GR4011" : "GR4012",
          message: `${hit.call} in ${file}`,
          at: { file, line: hit.line, column: null },
          feature: snapshot.ownership.files[file]?.owner ?? null,
        }),
      );
    }
  }

  return findings;
}
