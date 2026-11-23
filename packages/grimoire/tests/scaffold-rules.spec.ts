/**
 * The scaffold's own sources follow the four code rules (logical CSS,
 * specific errors, `type` discriminators, no `.js` imports), so a new app
 * starts with `rules:` turned on and nothing to fix.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isRuleFile, runCodeRules } from "../src/rules";

const template = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "create-warlock",
  "templates",
  "warlock",
);

function filesUnder(folder: string): string[] {
  const found: string[] = [];

  for (const name of readdirSync(folder)) {
    const absolute = path.join(folder, name);

    if (statSync(absolute).isDirectory()) found.push(...filesUnder(absolute));
    else found.push(absolute);
  }

  return found;
}

describe("the scaffold's sources", () => {
  it("report nothing for the four code rules", () => {
    const files = [
      ...filesUnder(path.join(template, "src")),
      path.join(template, "e2e", "home.e2e.ts"),
    ]
      .map((file) => path.relative(template, file).split(path.sep).join("/"))
      .filter(isRuleFile);

    expect(files.length).toBeGreaterThan(10);

    const findings = files.flatMap((file) =>
      runCodeRules(file, readFileSync(path.join(template, ...file.split("/")), "utf8")).map(
        (finding) => `${file}:${finding.line} ${finding.code} ${finding.message}`,
      ),
    );

    expect(findings).toEqual([]);
  });
});
