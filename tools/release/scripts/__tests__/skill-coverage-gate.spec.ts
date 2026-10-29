import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  codeText,
  overAllowance,
  readAllowances,
  readExports,
  runSkillCoverageGate,
} from "../skill-coverage-gate.ts";

const desc = (n: number) => "d".repeat(n);
const front = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\nBody.\n`;

function withPackages(files: Record<string, string>, inspect: (root: string) => void): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "skill-coverage-"));
  try {
    for (const [file, text] of Object.entries(files)) {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    inspect(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("readExports", () => {
  it("reads declarations, braces, aliases, relative re-exports and skips externals", () => {
    withPackages(
      {
        "p/src/index.ts": [
          "// export const hidden = 1;",
          'export * from "./a";',
          'export * from "external-pkg";',
          'export * as ns from "./a";',
          'export { b as renamed, type T1 } from "./a";',
          "export type { Only } from './a';",
          "export const direct = 1;",
          "export async function run() {}",
          "export abstract class Base {}",
          "export interface Shape {}",
          "export default function ignored() {}",
        ].join("\n"),
        "p/src/a.ts": "export const fromA = 1;\nexport type AType = string;\n",
      },
      (root) => {
        const map = new Map(
          readExports(path.join(root, "p/src/index.ts")).map((e) => [e.name, e.typeOnly]),
        );
        assert.equal(map.get("fromA"), false);
        assert.equal(map.get("AType"), true);
        assert.equal(map.get("ns"), false);
        assert.equal(map.get("renamed"), false);
        assert.equal(map.get("T1"), true);
        assert.equal(map.get("Only"), true);
        assert.equal(map.get("direct"), false);
        assert.equal(map.get("run"), false);
        assert.equal(map.get("Base"), false);
        assert.equal(map.get("Shape"), true);
        assert.equal(map.has("hidden"), false);
        assert.equal(map.has("ignored"), false);
      },
    );
  });
});

describe("codeText", () => {
  it("keeps inline code and fences and drops prose", () => {
    const text = codeText("prose word\n`inline` here\n```ts\nfenced(1)\n```\nmore prose\n");
    assert.match(text, /inline/);
    assert.match(text, /fenced/);
    assert.doesNotMatch(text, /prose/);
  });
});

describe("runSkillCoverageGate", () => {
  const good = {
    "p/skills/index.md": front("x", desc(450)),
    "p/skills/a/SKILL.md": front("a", "topic a"),
    "p/skills/b/SKILL.md": front("b", "topic b"),
    "p/src/index.ts": "export const covered = 1;\nexport const missing = 2;\nexport type T = 1;\n",
  };

  it("counts value exports no skill mentions in code, not types, not bare prose", () => {
    withPackages(
      {
        ...good,
        "p/skills/a/SKILL.md": `${front("a", "topic a")}\nUse \`covered\`. missing is prose only.\n`,
      },
      (root) => {
        const report = runSkillCoverageGate(root);
        assert.deepEqual(report.issues, []);
        assert.deepEqual(report.packages[0]?.uncovered, ["missing"]);
        assert.deepEqual(report.packages[0]?.uncoveredTypes, ["T"]);
      },
    );
  });

  it("fails multi-topic packages without an index", () => {
    withPackages({ ...good, "p/skills/index.md": "" }, (root) => {
      // an empty index.md is still an index; remove it by not writing one
      assert.equal(runSkillCoverageGate(root).issues[0]?.type, "missing-index-description");
    });
    withPackages(
      {
        "p/skills/a/SKILL.md": front("a", "x"),
        "p/skills/b/SKILL.md": front("b", "x"),
      },
      (root) => {
        assert.deepEqual(
          runSkillCoverageGate(root).issues.map((i) => i.type),
          ["missing-index"],
        );
      },
    );
  });

  it("enforces the 400-700 index description budget", () => {
    for (const [length, ok] of [
      [399, false],
      [400, true],
      [700, true],
      [701, false],
    ] as const) {
      withPackages({ ...good, "p/skills/index.md": front("x", desc(length)) }, (root) => {
        const types = runSkillCoverageGate(root).issues.map((i) => i.type);
        assert.deepEqual(types, ok ? [] : ["index-description-length"], `length ${length}`);
      });
    }
  });

  it("requires name and description on topic skills", () => {
    withPackages(
      {
        ...good,
        "p/skills/a/SKILL.md": "---\ndescription: only\n---\n",
        "p/skills/b/SKILL.md": "---\nname: b\n---\n",
      },
      (root) => {
        assert.deepEqual(
          runSkillCoverageGate(root).issues.map((i) => i.type),
          ["missing-topic-name", "missing-topic-description"],
        );
      },
    );
  });
});

describe("overAllowance", () => {
  const pkg = (dir: string, n: number) => ({
    dir,
    uncovered: Array.from({ length: n }, (_, i) => `n${i}`),
    uncoveredTypes: [],
    valueExports: n,
  });

  it("fails only when the count goes up or no allowance exists", () => {
    const result = overAllowance([pkg("a", 2), pkg("b", 3), pkg("c", 1)], { a: 2, b: 2 });
    assert.deepEqual(
      result.map((r) => r.dir),
      ["b", "c"],
    );
  });
});

describe("recorded allowances", () => {
  it("parses and covers every measured package at or below its allowance", () => {
    const report = runSkillCoverageGate(path.resolve(import.meta.dirname, "../../../../packages"));
    assert.deepEqual(report.issues, []);
    assert.deepEqual(overAllowance(report.packages, readAllowances()), []);
  });
});
