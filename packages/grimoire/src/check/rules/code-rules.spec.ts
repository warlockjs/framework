import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { snapshot } from "../../../tests/check/snapshot-builder";
import {
  DEFAULT_GRIMOIRE_SETTINGS,
  type CodeRuleName,
  type GrimoireSnapshot,
} from "../../contracts";
import { checkCodeRules } from "./code-rules";

const root = mkdtempSync(path.join(tmpdir(), "grimoire-code-rules-"));
const files: Record<string, string> = {
  "src/app/shop/card.tsx": 'export const card = <div className="ml-4 flex" />;\n',
  "src/app/shop/styles.css": ".a { text-align: left; }\n",
  "src/app/shop/errors.ts":
    'export const message = "Something went wrong";\nexport const level = "error";\n',
  "src/app/shop/types.ts": 'export type A = { kind: "a" };\nimport x from "./x.js";\n',
  "src/app/shop/card.spec.ts": 'const a = "ml-4";\n',
  "src/locales/en.json": '{ "failed": "Oops" }\n',
  "src/app/shop/clean.ts": "export const clean = 1;\n",
  "dist/out.ts": 'const a = "ml-4";\n',
};

for (const [file, text] of Object.entries(files)) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

function withRules(rules: CodeRuleName[] | null): GrimoireSnapshot {
  const target = snapshot({ root, settings: { ...DEFAULT_GRIMOIRE_SETTINGS, rules } });

  target.book.manifest.files = Object.fromEntries(
    Object.keys(files).map((file) => [file, { hash: "", size: 0, mtimeMs: 0, entry: null }]),
  );
  target.ownership.files["src/app/shop/card.tsx"] = {
    file: "src/app/shop/card.tsx",
    owner: "shop",
    via: "folder",
    folder: null,
    conflicts: [],
    borrowedBy: [],
  };

  return target;
}

const where = (target: GrimoireSnapshot) =>
  checkCodeRules(target).map(
    (finding) => `${finding.code} ${finding.at?.file}:${finding.at?.line}`,
  );

describe("checkCodeRules", () => {
  it("runs nothing when the settings write no rules, or an empty list", () => {
    expect(where(withRules(null))).toEqual([]);
    expect(where(withRules([]))).toEqual([]);
    expect(checkCodeRules(snapshot({ root }))).toEqual([]);
  });

  it("runs the written rules over every code, style and locale file, skipping specs and builds", () => {
    expect(
      where(withRules(["logical-css", "specific-errors", "type-discriminator", "no-js-imports"])),
    ).toEqual([
      "GR3007 src/app/shop/card.tsx:1",
      "GR3008 src/app/shop/errors.ts:1",
      "GR3007 src/app/shop/styles.css:1",
      "GR3009 src/app/shop/types.ts:1",
      "GR3010 src/app/shop/types.ts:2",
      "GR3008 src/locales/en.json:1",
    ]);
  });

  it("runs only the rules the settings name, and names the owner", () => {
    const target = withRules(["logical-css"]);

    expect(where(target)).toEqual([
      "GR3007 src/app/shop/card.tsx:1",
      "GR3007 src/app/shop/styles.css:1",
    ]);
    expect(checkCodeRules(target)[0]?.subject.feature).toBe("shop");
  });
});
