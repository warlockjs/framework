/**
 * GR3007-GR3010: the code rules the settings turn on (`rules:` in
 * `grimoire/settings.md`), over every code and style file of the source
 * roots. A project that writes no `rules:` runs none here (the guard still
 * runs all four on the lines a change adds).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createFinding } from "../../codes";
import type { GrimoireFinding } from "../../contracts/findings";
import { DEFAULT_GRIMOIRE_SETTINGS } from "../../contracts/settings";
import type { GrimoireSnapshot } from "../../contracts/snapshot";
import { isRuleFile, runCodeRules } from "../../rules";

export function checkCodeRules(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const rules = (snapshot.settings ?? DEFAULT_GRIMOIRE_SETTINGS).rules;

  if (rules === null || rules.length === 0) return [];

  const findings: GrimoireFinding[] = [];
  const files = Object.keys(snapshot.book.manifest.files).filter(isRuleFile).sort();

  for (const file of files) {
    let text: string;

    try {
      text = readFileSync(path.join(snapshot.root, ...file.split("/")), "utf8");
    } catch {
      continue;
    }

    for (const hit of runCodeRules(file, text, rules)) {
      const owner = snapshot.ownership.files[file]?.owner ?? null;

      findings.push(
        createFinding({
          code: hit.code,
          message: hit.message,
          at: { file, line: hit.line, column: hit.column },
          feature: owner,
        }),
      );
    }
  }

  return findings;
}
