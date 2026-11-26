import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// create-warlock does not depend on grimoire, so the rule runner is read from its source.
import { runCodeRules } from "../../grimoire/src/rules/index";

const templatesDir = path.resolve(__dirname, "../templates");

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (name === "node_modules") return [];

    const full = path.join(directory, name);

    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("templates follow the logical-css rule", () => {
  for (const template of ["warlock", "design-system", "design-system-mantine"]) {
    it(`${template}: no physical direction in any file`, () => {
      const root = path.join(templatesDir, template);
      const findings = walk(root).flatMap((file) =>
        runCodeRules(file, readFileSync(file, "utf8"), ["logical-css"]).map(
          (finding) => `${path.relative(root, file)}:${finding.line} ${finding.message}`,
        ),
      );

      expect(findings).toEqual([]);
    });
  }
});
