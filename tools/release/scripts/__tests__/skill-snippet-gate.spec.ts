import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  REPO_ROOT,
  GATE_TMP_DIR_NAME,
  runSkillSnippetGate,
  classifyBlock,
  compileSkill,
  compileManySkills,
  countFailuresByPackage,
  discoverPackages,
  discoverSkillFiles,
  evaluateRatchet,
  extractFencedBlocks,
  findCrossSkillTypePathConflicts,
  planSkillCompileUnit,
  readAllowances,
  type DiscoveredSkill,
  type ExtractedBlock,
  type GateReport,
  type SkillCompileResult,
  type WorkspacePackage,
} from "../skill-snippet-gate.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/**
 * A fixture root lives UNDER the real repo root (not system tmpdir) so that
 * `@types/node` (hoisted to the real root's `node_modules` by
 * `pnpm-workspace.yaml`'s `publicHoistPattern`) resolves for the fixture the
 * same way it resolves for real skill packages — exercising the exact
 * ancestor-`node_modules` path the real gate relies on.
 */
async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(REPO_ROOT, ".skill-snippet-gate-spec-"));
  temporaryRoots.push(root);
  return root;
}

async function writeFixturePackage(
  root: string,
  dir: string,
  name: string,
  indexBody: string,
): Promise<WorkspacePackage> {
  const absPath = path.join(root, dir);
  await mkdir(path.join(absPath, "src"), { recursive: true });
  await writeFile(path.join(absPath, "package.json"), JSON.stringify({ name }), "utf8");
  await writeFile(path.join(absPath, "src", "index.ts"), indexBody, "utf8");
  await mkdir(path.join(absPath, "skills"), { recursive: true });
  return { dir, absPath, name };
}

function skillFor(pkg: WorkspacePackage, slug: string, filePath: string): DiscoveredSkill {
  return { package: pkg, filePath, slug };
}

describe("discoverPackages / discoverSkillFiles", () => {
  it("derives packages from the filesystem, not a hardcoded list", async () => {
    const root = await fixtureRoot();
    await writeFixturePackage(root, "widgets", "@fixture/widgets", "export const widget = 1;\n");
    // A directory with package.json but NO skills/ must be excluded.
    await mkdir(path.join(root, "no-skills-here"), { recursive: true });
    await writeFile(path.join(root, "no-skills-here", "package.json"), "{}", "utf8");
    // A directory with skills/ but NO package.json must be excluded.
    await mkdir(path.join(root, "not-a-package", "skills"), { recursive: true });

    const packages = discoverPackages(root);
    assert.deepEqual(
      packages.map((p) => p.dir),
      ["widgets"],
    );
  });

  it("finds every SKILL.md under a package's skills/ tree, at any depth", async () => {
    const root = await fixtureRoot();
    const pkg = await writeFixturePackage(
      root,
      "widgets",
      "@fixture/widgets",
      "export const widget = 1;\n",
    );
    await mkdir(path.join(pkg.absPath, "skills", "make-a-widget"), { recursive: true });
    await writeFile(
      path.join(pkg.absPath, "skills", "make-a-widget", "SKILL.md"),
      "# widget\n",
      "utf8",
    );

    const skills = discoverSkillFiles(pkg);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].slug, "make-a-widget");
  });
});

describe("runSkillSnippetGate — temporary directory cleanup", () => {
  for (const broken of [false, true]) {
    it(`cleans temporary files after ${broken ? "failing" : "passing"} compilation`, async () => {
      const root = await fixtureRoot();
      const pkg = await writeFixturePackage(
        root,
        "widgets",
        "@fixture/widgets",
        "export const widget = 1;\n",
      );
      await writeFile(
        path.join(pkg.absPath, "skills", "SKILL.md"),
        [
          '```ts title="src/example.ts"',
          `export const value: string = ${broken ? "42" : '"ok"'};`,
          "```",
        ].join("\n"),
      );
      const report = runSkillSnippetGate(root);
      assert.equal(countFailuresByPackage(report)[0].failed, broken ? 1 : 0);
      assert.equal(existsSync(path.join(root, GATE_TMP_DIR_NAME)), false);
    });
  }

  it("cleans temporary files when package discovery throws", async () => {
    const root = await fixtureRoot();
    const pkg = await writeFixturePackage(
      root,
      "widgets",
      "@fixture/widgets",
      "export const widget = 1;\n",
    );
    await writeFile(path.join(pkg.absPath, "package.json"), "{invalid json");
    assert.throws(() => runSkillSnippetGate(root));
    assert.equal(existsSync(path.join(root, GATE_TMP_DIR_NAME)), false);
  });
});

describe("extractFencedBlocks", () => {
  const pkg: WorkspacePackage = { dir: "x", absPath: "/x", name: "@fixture/x" };
  const skill = skillFor(pkg, "s", "/x/skills/s/SKILL.md");

  it("extracts ts and tsx fences with their title= attribute", () => {
    const markdown = [
      '```ts title="src/app/a.ts"',
      "export const a = 1;",
      "```",
      "",
      "```tsx",
      "const b = <div />;",
      "```",
      "",
      "```typescript",
      "// out of literal scope, ignored",
      "```",
    ].join("\n");

    const blocks = extractFencedBlocks(markdown, skill);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].lang, "ts");
    assert.equal(blocks[0].titlePath, "src/app/a.ts");
    assert.equal(blocks[1].lang, "tsx");
    assert.equal(blocks[1].titlePath, undefined);
  });

  it("does not treat prose titles as file paths", () => {
    const markdown = ['```ts title="inside your connector class"', "doSomething();", "```"].join(
      "\n",
    );
    const blocks = extractFencedBlocks(markdown, skill);
    assert.equal(blocks[0].titlePath, undefined);
  });
});

describe("classifyBlock — partial vs. broken", () => {
  const pkg: WorkspacePackage = { dir: "x", absPath: "/x", name: "@fixture/x" };
  const skill = skillFor(pkg, "s", "/x/skills/s/SKILL.md");

  it("always compiles a titled block, even with zero imports (the defect shape this gate must catch)", () => {
    const [block] = extractFencedBlocks(
      [
        '```ts title="src/app/x.controller.ts"',
        "export const h = (req, res) => res.success();",
        "```",
      ].join("\n"),
      skill,
    );
    const classified = classifyBlock(block);
    assert.equal(classified.kind, "compile");
  });

  it("compiles an untitled block that carries its own import", () => {
    const [block] = extractFencedBlocks(
      ["```ts", 'import { x } from "@warlock.js/x";', "x();", "```"].join("\n"),
      skill,
    );
    const classified = classifyBlock(block);
    assert.equal(classified.kind, "compile");
  });

  it("skips an untitled, import-free fragment as deliberate", () => {
    const [block] = extractFencedBlocks(
      ["```ts", "return response.success({ ok: true });", "```"].join("\n"),
      skill,
    );
    const classified = classifyBlock(block);
    assert.equal(classified.kind, "skip");
  });
});

describe("planSkillCompileUnit — duplicate titles within one skill", () => {
  it("keeps the first occurrence at its real path and routes the second to a synthetic path", () => {
    const pkg: WorkspacePackage = { dir: "x", absPath: "/x", name: "@fixture/x" };
    const skill = skillFor(pkg, "s", "/x/skills/s/SKILL.md");
    const markdown = [
      '```ts title="src/config/http.ts"',
      "export default { port: 3000 };",
      "```",
      "",
      '```ts title="src/config/http.ts"',
      "export default { port: 4000 };",
      "```",
    ].join("\n");
    const blocks = extractFencedBlocks(markdown, skill);
    const plan = planSkillCompileUnit(skill, blocks);
    assert.equal(plan.files.size, 2);
    assert.equal(plan.duplicateTitles.length, 1);
    assert.equal(plan.duplicateTitles[0].titlePath, "src/config/http.ts");
  });
});

describe("compileSkill — real compilation against real declarations, with a red control", () => {
  it("passes a correct snippet, fails the SAME snippet once an import is stripped, then passes again restored", async () => {
    const root = await fixtureRoot();
    const pkg = await writeFixturePackage(
      root,
      "fixture-pkg",
      "@fixture/pkg",
      "export function greet(name: string): string {\n  return `hi ${name}`;\n}\n",
    );
    await mkdir(path.join(pkg.absPath, "skills", "greet"), { recursive: true });
    const skillFile = path.join(pkg.absPath, "skills", "greet", "SKILL.md");
    const goodMarkdown = [
      "---",
      "name: greet",
      "---",
      "",
      '```ts title="src/app/greet.ts"',
      'import { greet } from "@fixture/pkg";',
      "",
      'export const message = greet("world");',
      "```",
    ].join("\n");
    await writeFile(skillFile, goodMarkdown, "utf8");

    const skill: DiscoveredSkill = { package: pkg, filePath: skillFile, slug: "greet" };
    const gateTmpRoot = path.join(root, ".gate-tmp");

    const passing = compileSkill(skill, [pkg], gateTmpRoot);
    assert.equal(passing.files.length, 1);
    assert.deepEqual(passing.files[0].diagnostics, []);
    // Known-freshness: the file the gate reports as passing must actually
    // exist on disk, at the path it names, with the content it claims to
    // have compiled — not asserted from memory.
    const { readFile } = await import("node:fs/promises");
    const onDisk = await readFile(passing.files[0].absolutePath, "utf8");
    assert.equal(
      onDisk,
      'import { greet } from "@fixture/pkg";\n\nexport const message = greet("world");\n',
    );

    // RED CONTROL: strip the import in a temp copy of the same snippet — the
    // exact "no import lines at all" defect shape — and prove the gate fails
    // it with the compiler's OWN error text, not a synthetic one.
    const brokenMarkdown = goodMarkdown.replace('import { greet } from "@fixture/pkg";\n\n', "");
    await writeFile(skillFile, brokenMarkdown, "utf8");
    const failing = compileSkill(skill, [pkg], gateTmpRoot);
    assert.equal(failing.files.length, 1);
    assert.ok(
      failing.files[0].diagnostics.length > 0,
      "expected the compiler to report a real error",
    );
    assert.ok(
      failing.files[0].diagnostics.some((d) => /Cannot find name 'greet'/.test(d)),
      `expected a "Cannot find name 'greet'" diagnostic, got: ${failing.files[0].diagnostics.join(" | ")}`,
    );

    // Restore and confirm it passes again.
    await writeFile(skillFile, goodMarkdown, "utf8");
    const restored = compileSkill(skill, [pkg], gateTmpRoot);
    assert.deepEqual(restored.files[0].diagnostics, []);
  });

  it("resolves source subpaths and the skill owner's installed dependency subpaths", async () => {
    const root = await fixtureRoot();
    const pkg = await writeFixturePackage(
      root,
      "widgets",
      "@fixture/widgets",
      "export const widget = 1;\n",
    );
    await mkdir(path.join(pkg.absPath, "src", "tests"), { recursive: true });
    await writeFile(
      path.join(pkg.absPath, "src", "tests", "index.ts"),
      "export const request = () => 200;\n",
    );
    const dependency = path.join(pkg.absPath, "node_modules", "fixture-test-runner");
    await mkdir(dependency, { recursive: true });
    await writeFile(
      path.join(dependency, "package.json"),
      JSON.stringify({ name: "fixture-test-runner", exports: { "./config": "./config.d.ts" } }),
    );
    await writeFile(
      path.join(dependency, "config.d.ts"),
      "export declare function defineConfig(value: { status: number }): unknown;\n",
    );
    const skillFile = path.join(pkg.absPath, "skills", "SKILL.md");
    await writeFile(
      skillFile,
      [
        '```ts title="src/example.ts"',
        'import { request } from "@fixture/widgets/tests";',
        'import { defineConfig } from "fixture-test-runner/config";',
        "export default defineConfig({ status: request() });",
        "```",
      ].join("\n"),
    );
    const result = compileSkill(
      skillFor(pkg, "http-test", skillFile),
      [pkg],
      path.join(root, ".gate-tmp"),
    );
    assert.deepEqual(result.files[0].diagnostics, []);

    await writeFile(
      skillFile,
      '```ts\nimport { missing } from "@fixture/widgets/does-not-exist";\nmissing();\n```',
    );
    const broken = compileSkill(
      skillFor(pkg, "http-test", skillFile),
      [pkg],
      path.join(root, ".gate-tmp"),
    );
    assert.ok(
      broken.files[0].diagnostics.some((diagnostic) => /Cannot find module/.test(diagnostic)),
    );
  });

  it("honours explicit package exports without exposing existing internal source files", async () => {
    const root = await fixtureRoot();
    const pkg = await writeFixturePackage(
      root,
      "widgets",
      "@fixture/widgets",
      "export const widget = 1;\n",
    );
    await writeFile(
      path.join(pkg.absPath, "package.json"),
      JSON.stringify({
        name: pkg.name,
        exports: { ".": { types: "./src/index.ts" }, "./public": "./src/public.ts" },
      }),
    );
    await writeFile(path.join(pkg.absPath, "src", "public.ts"), "export const published = 1;\n");
    await writeFile(path.join(pkg.absPath, "src", "internal.ts"), "export const secret = 1;\n");
    const skillFile = path.join(pkg.absPath, "skills", "SKILL.md");
    await writeFile(
      skillFile,
      '```ts\nimport { widget } from "@fixture/widgets";\nimport { published } from "@fixture/widgets/public";\nconsole.log(widget, published);\n```',
    );
    const skill = skillFor(pkg, "exports", skillFile);
    assert.deepEqual(
      compileSkill(skill, [pkg], path.join(root, ".gate-tmp")).files[0].diagnostics,
      [],
    );
    await writeFile(
      skillFile,
      '```ts\nimport { secret } from "@fixture/widgets/internal";\nconsole.log(secret);\n```',
    );
    const broken = compileSkill(skill, [pkg], path.join(root, ".gate-tmp"));
    assert.ok(
      broken.files[0].diagnostics.some((diagnostic) => /Cannot find module/.test(diagnostic)),
    );
  });

  it("keeps application declaration merging isolated to the skill that declares it", async () => {
    const root = await fixtureRoot();
    const pkg = await writeFixturePackage(
      root,
      "widgets",
      "@fixture/widgets",
      "export interface Registry {}\nexport type Name = keyof Registry extends never ? string : keyof Registry;\nexport function name(value: Name) { return value; }\n",
    );
    const skills: DiscoveredSkill[] = [];
    for (const [slug, body] of [
      [
        "registered",
        'import { name } from "@fixture/widgets";\ndeclare module "@fixture/widgets" { interface Registry { registered: true } }\nname("registered");',
      ],
      ["unregistered", 'import { name } from "@fixture/widgets";\nname("other-app-route");'],
    ]) {
      const file = path.join(pkg.absPath, "skills", slug, "SKILL.md");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "```ts\n" + body + "\n```");
      skills.push(skillFor(pkg, slug, file));
    }
    const results = compileManySkills(skills, [pkg], path.join(root, ".gate-tmp"));
    assert.deepEqual(
      results.flatMap((result) => result.files.flatMap((file) => file.diagnostics)),
      [],
    );
  });

  it("fails a titled block whose relative import names a file that does not exist (defect #1's shape)", async () => {
    const root = await fixtureRoot();
    const pkg = await writeFixturePackage(
      root,
      "fixture-pkg",
      "@fixture/pkg",
      "export const noop = 1;\n",
    );
    await mkdir(path.join(pkg.absPath, "skills", "missing-schema"), { recursive: true });
    const skillFile = path.join(pkg.absPath, "skills", "missing-schema", "SKILL.md");
    const markdown = [
      "---",
      "name: missing-schema",
      "---",
      "",
      '```ts title="src/app/uploads/controllers/upload-avatar.controller.ts"',
      'import { uploadAvatarSchema } from "../schema/upload-avatar.schema";',
      "",
      "export const x = uploadAvatarSchema;",
      "```",
    ].join("\n");
    await writeFile(skillFile, markdown, "utf8");

    const skill: DiscoveredSkill = { package: pkg, filePath: skillFile, slug: "missing-schema" };
    const result = compileSkill(skill, [pkg], path.join(root, ".gate-tmp"));
    assert.equal(result.files.length, 1);
    assert.ok(result.files[0].diagnostics.some((d) => /Cannot find module/.test(d)));
  });
});

describe("ratchet — per-package baseline enforcement", () => {
  const pkgA: WorkspacePackage = { dir: "a", absPath: "/a", name: "@fixture/a" };
  const pkgB: WorkspacePackage = { dir: "b", absPath: "/b", name: "@fixture/b" };

  function block(skill: DiscoveredSkill): ExtractedBlock {
    return { skill, index: 0, lang: "ts", info: "", body: "", line: 1 };
  }

  function resultWith(
    pkg: WorkspacePackage,
    slug: string,
    failedCount: number,
    passedCount: number,
  ): SkillCompileResult {
    const skill = skillFor(pkg, slug, `/${pkg.dir}/skills/${slug}/SKILL.md`);
    const files = [
      ...Array.from({ length: failedCount }, (_, i) => ({
        virtualPath: `fail-${i}.ts`,
        absolutePath: `/tmp/fail-${i}.ts`,
        block: block(skill),
        diagnostics: ["x.ts(1,1): error TS2304: Cannot find name 'x'."],
      })),
      ...Array.from({ length: passedCount }, (_, i) => ({
        virtualPath: `ok-${i}.ts`,
        absolutePath: `/tmp/ok-${i}.ts`,
        block: block(skill),
        diagnostics: [] as string[],
      })),
    ];
    return {
      skill,
      skillRoot: `/tmp/${pkg.dir}/${slug}`,
      tsconfigPath: `/tmp/${pkg.dir}/${slug}/tsconfig.json`,
      files,
      skipped: [],
      duplicateTitles: [],
    };
  }

  function reportWith(
    results: SkillCompileResult[],
    packages: WorkspacePackage[],
    conflicts: GateReport["typePathConflicts"] = [],
  ): GateReport {
    return { packages, skills: results.map((r) => r.skill), results, typePathConflicts: conflicts };
  }

  it("counts failing compiled snippets per package, ignoring passing ones", () => {
    const report = reportWith(
      [resultWith(pkgA, "s1", 2, 1), resultWith(pkgA, "s2", 1, 3), resultWith(pkgB, "s3", 0, 2)],
      [pkgA, pkgB],
    );
    assert.deepEqual(countFailuresByPackage(report), [
      { dir: "a", failed: 3 },
      { dir: "b", failed: 0 },
    ]);
  });

  it("passes when every package is at or under its allowance", () => {
    const report = reportWith(
      [resultWith(pkgA, "s1", 3, 0), resultWith(pkgB, "s2", 0, 1)],
      [pkgA, pkgB],
    );
    const ratchet = evaluateRatchet(report, { a: 3, b: 0 });
    assert.equal(ratchet.failed, false);
    assert.equal(ratchet.totalFailed, 3);
    assert.equal(ratchet.totalAllowance, 3);
  });

  it("RED CONTROL: one NEW failure over the baseline fails the ratchet", () => {
    const report = reportWith(
      [resultWith(pkgA, "s1", 4, 0), resultWith(pkgB, "s2", 0, 1)],
      [pkgA, pkgB],
    );
    const ratchet = evaluateRatchet(report, { a: 3, b: 0 });
    assert.equal(ratchet.failed, true);
    assert.equal(ratchet.rows.find((r) => r.dir === "a")?.over, 1);
  });

  it("a cross-skill type/path conflict fails the ratchet even at a clean baseline (hard zero)", () => {
    const report = reportWith(
      [resultWith(pkgA, "s1", 0, 1)],
      [pkgA],
      [{ typeName: "Product", occurrences: [] }],
    );
    const ratchet = evaluateRatchet(report, { a: 0 });
    assert.equal(ratchet.failed, true);
    assert.equal(ratchet.typePathConflicts, 1);
  });

  it("a measured package with no recorded allowance throws (never silently treated as zero)", () => {
    const report = reportWith([resultWith(pkgA, "s1", 1, 0)], [pkgA]);
    assert.throws(
      () => evaluateRatchet(report, {}),
      /No skill-snippet allowance recorded for package 'a'/,
    );
  });

  it("the committed baseline is valid JSONC with numeric allowances", () => {
    const allowances = readAllowances();
    for (const [dir, value] of Object.entries(allowances)) {
      assert.equal(typeof value, "number", `allowance for '${dir}' must be a number`);
      assert.ok(value >= 0, `allowance for '${dir}' must be >= 0`);
    }
    // Sanity: the baseline recorded at authoring time.
    assert.equal(
      Object.values(allowances).reduce((sum, n) => sum + n, 0),
      21,
    );
  });
});

describe("findCrossSkillTypePathConflicts", () => {
  it("flags the same exported type name documented at two different paths across skills", () => {
    const pkg: WorkspacePackage = { dir: "x", absPath: "/x", name: "@fixture/x" };
    const skillA = skillFor(pkg, "a", "/x/skills/a/SKILL.md");
    const skillB = skillFor(pkg, "b", "/x/skills/b/SKILL.md");
    const blockA = extractFencedBlocks(
      [
        '```ts title="src/app/products/models/product.model.ts"',
        "export type Product = { id: string };",
        "```",
      ].join("\n"),
      skillA,
    )[0];
    const blockB = extractFencedBlocks(
      [
        '```ts title="src/app/catalog/models/product.model.ts"',
        "export type Product = { id: string };",
        "```",
      ].join("\n"),
      skillB,
    )[0];

    const conflicts = findCrossSkillTypePathConflicts([
      {
        skill: skillA,
        skillRoot: "/tmp/a",
        tsconfigPath: "/tmp/a/tsconfig.json",
        files: [
          {
            virtualPath: "src/app/products/models/product.model.ts",
            absolutePath: "/tmp/a/x.ts",
            block: blockA,
            diagnostics: [],
          },
        ],
        skipped: [],
        duplicateTitles: [],
      },
      {
        skill: skillB,
        skillRoot: "/tmp/b",
        tsconfigPath: "/tmp/b/tsconfig.json",
        files: [
          {
            virtualPath: "src/app/catalog/models/product.model.ts",
            absolutePath: "/tmp/b/x.ts",
            block: blockB,
            diagnostics: [],
          },
        ],
        skipped: [],
        duplicateTitles: [],
      },
    ]);

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].typeName, "Product");
  });

  it("does not flag the same type documented at the SAME path across skills", () => {
    const pkg: WorkspacePackage = { dir: "x", absPath: "/x", name: "@fixture/x" };
    const skillA = skillFor(pkg, "a", "/x/skills/a/SKILL.md");
    const skillB = skillFor(pkg, "b", "/x/skills/b/SKILL.md");
    const block = extractFencedBlocks(
      [
        '```ts title="src/app/products/models/product.model.ts"',
        "export type Product = { id: string };",
        "```",
      ].join("\n"),
      skillA,
    )[0];

    const conflicts = findCrossSkillTypePathConflicts([
      {
        skill: skillA,
        skillRoot: "/tmp/a",
        tsconfigPath: "/tmp/a/tsconfig.json",
        files: [
          {
            virtualPath: "src/app/products/models/product.model.ts",
            absolutePath: "/tmp/a/x.ts",
            block,
            diagnostics: [],
          },
        ],
        skipped: [],
        duplicateTitles: [],
      },
      {
        skill: skillB,
        skillRoot: "/tmp/b",
        tsconfigPath: "/tmp/b/tsconfig.json",
        files: [
          {
            virtualPath: "src/app/products/models/product.model.ts",
            absolutePath: "/tmp/b/x.ts",
            block,
            diagnostics: [],
          },
        ],
        skipped: [],
        duplicateTitles: [],
      },
    ]);

    assert.equal(conflicts.length, 0);
  });
});
