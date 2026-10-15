#!/usr/bin/env node
/**
 * Guard against a spec/test file that no vitest `include` glob can see.
 *
 * Card 7761af8f found that `core/vitest.config.ts` only ran
 * `tests/{unit,integration}/**\/*.test.ts`, so a spec written next to the
 * code it tests (`core/src/**\/*.spec.ts`) was silently never executed — it
 * passed review, got committed, and reported nothing, forever. This script
 * is the recurrence guard: for every workspace package, it unions the
 * `include` globs out of every `vitest*.config.ts` in that package (falling
 * back to Vitest's own default include when a package ships no config at
 * all — several `ai-*` packages do this deliberately), matches every
 * git-tracked `*.spec.ts` / `*.test.ts` file in the package against that
 * union, and fails loudly, naming names, for any file matched by none of
 * them.
 *
 * Usage (from the workspace root):
 *   node scripts/check-spec-coverage.mjs
 *
 * Exit code is non-zero iff at least one orphan file is found.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Vitest's own default when a package defines no `test.include` at all. */
const VITEST_DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];
const VITEST_DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/cypress/**",
  "**/.{idea,git,cache,output,temp}/**",
];

/**
 * Pull every `include: [...]` / `exclude: [...]` array literal out of a
 * vitest config's source text, skipping any that live inside a `coverage: {
 * ... }` block (coverage's `include`/`exclude` describe instrumentation
 * targets, not which files vitest treats as tests).
 */
function extractGlobArrays(source, key) {
  const withoutCoverageBlocks = stripBalancedBlocks(source, "coverage:");
  const globs = [];
  const re = new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`, "g");
  let match;

  while ((match = re.exec(withoutCoverageBlocks))) {
    // Quote-aware split: a single glob like "tests/{unit,integration}/**"
    // has a comma INSIDE it (brace-expansion), so a plain `.split(",")`
    // would slice that one string in two. Only split on commas that sit
    // OUTSIDE a quoted string literal.
    for (const literal of match[1].matchAll(/["'`]((?:\\.|[^\\])*?)["'`]/g)) {
      if (literal[1]) {
        globs.push(literal[1]);
      }
    }
  }

  return globs;
}

/** Removes every `<label>{ ... }` block (brace-balanced) from `source`. */
function stripBalancedBlocks(source, label) {
  let result = "";
  let index = 0;

  while (index < source.length) {
    const start = source.indexOf(label, index);

    if (start === -1) {
      result += source.slice(index);
      break;
    }

    result += source.slice(index, start);
    const braceStart = source.indexOf("{", start);

    if (braceStart === -1) {
      result += source.slice(start);
      break;
    }

    let depth = 1;
    let cursor = braceStart + 1;

    while (cursor < source.length && depth > 0) {
      if (source[cursor] === "{") depth++;
      else if (source[cursor] === "}") depth--;
      cursor++;
    }

    index = cursor;
  }

  return result;
}

/**
 * Extracts the balanced-brace CONTENTS of every `<label>: {` occurrence in
 * `source` (used to pull out `test: { ... }` blocks, including nested
 * per-project ones inside a `projects: [...]` array).
 */
function extractBlocks(source, label) {
  const blocks = [];
  let index = 0;

  while (index < source.length) {
    const start = source.indexOf(label, index);

    if (start === -1) break;

    const braceStart = source.indexOf("{", start);

    if (braceStart === -1) break;

    let depth = 1;
    let cursor = braceStart + 1;

    while (cursor < source.length && depth > 0) {
      if (source[cursor] === "{") depth++;
      else if (source[cursor] === "}") depth--;
      cursor++;
    }

    blocks.push(source.slice(braceStart + 1, cursor - 1));
    index = cursor;
  }

  return blocks;
}

/**
 * Returns each config's LEAF `test:` blocks — i.e. the actual include/exclude
 * pairs Vitest resolves a run against. A single-project config has exactly
 * one (no nested `projects:`); a multi-project config (like web's) nests one
 * `test:` block per project inside `projects: [...]`, and the outer `test:`
 * block is discarded here since its own include/exclude lines (if any) don't
 * apply once `projects` takes over, and mixing it in would let one project's
 * `exclude` wrongly cancel another project's `include` match.
 */
function findLeafTestBlocks(source) {
  return extractBlocks(source, "test:").filter(
    (block) => !/\bprojects\s*:/.test(block),
  );
}

function findConfigFiles(packageDir) {
  return fs
    .readdirSync(packageDir)
    .filter((name) => /^vitest.*\.config\.(ts|mts|js|mjs)$/.test(name))
    .map((name) => path.join(packageDir, name));
}

/**
 * `git ls-files` run FROM the package directory lists only that package's
 * tracked files, with paths relative to the package.
 */
function gitTrackedSpecFiles(packageDir) {
  const output = execFileSync(
    "git",
    ["ls-files", "--", "**/*.spec.ts", "**/*.test.ts"],
    { cwd: packageDir, encoding: "utf-8" },
  );

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((relative) => !isScaffoldTemplateFile(relative))
    .map((relative) => path.join(packageDir, relative));
}

/**
 * A spec under `templates/` belongs to the app the scaffolder GENERATES, not
 * to the package that ships it. It is copied into a new project and runs
 * there, under that project's own vitest config — so it is not an orphan, and
 * `create-warlock`'s own suite is right not to run it.
 *
 * This exemption is narrow on purpose. The guard's whole value is that it
 * fails, and a guard that fails on a file nobody intends to fix is one people
 * learn to skip — which is the defect this script exists to prevent, wearing a
 * different hat.
 */
function isScaffoldTemplateFile(relativePath) {
  return relativePath.split(/[\\/]/).includes("templates");
}

/**
 * One {include, exclude} pair per leaf test block, across every
 * `vitest*.config.ts` in the package. A file is "covered" if it matches
 * (include minus exclude) for AT LEAST ONE pair — each pair is kept separate
 * so one project's `exclude` can never cancel another project's `include`
 * (see `findLeafTestBlocks`), and so a package with a split
 * main/integration config (cascade, auth) has both pairs available.
 */
function resolvePackageMatchSets(packageDir) {
  const configFiles = findConfigFiles(packageDir);

  if (configFiles.length === 0) {
    return [{ include: VITEST_DEFAULT_INCLUDE, exclude: VITEST_DEFAULT_EXCLUDE }];
  }

  const pairs = [];

  for (const configFile of configFiles) {
    const source = fs.readFileSync(configFile, "utf-8");
    const leafBlocks = findLeafTestBlocks(source);

    for (const block of leafBlocks) {
      const include = extractGlobArrays(block, "include");
      const exclude = extractGlobArrays(block, "exclude");

      if (include.length > 0) {
        pairs.push({ include, exclude: [...exclude, ...VITEST_DEFAULT_EXCLUDE] });
      }
    }
  }

  return pairs.length > 0
    ? pairs
    : [{ include: VITEST_DEFAULT_INCLUDE, exclude: VITEST_DEFAULT_EXCLUDE }];
}

function findOrphans(packageDir) {
  const matchSets = resolvePackageMatchSets(packageDir);
  const trackedFiles = gitTrackedSpecFiles(packageDir);

  const matched = new Set();

  for (const { include, exclude } of matchSets) {
    for (const glob of include) {
      for (const hit of fs.globSync(glob, { cwd: packageDir, exclude })) {
        matched.add(path.join(packageDir, hit).split(path.sep).join("/"));
      }
    }
  }

  return trackedFiles.filter(
    (absolute) => !matched.has(absolute.split(path.sep).join("/")),
  );
}

function listPackageDirs() {
  const packagesRoot = path.join(workspaceRoot, "packages");

  return fs
    .readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => entry.name !== "node_modules")
    .map((entry) => path.join(packagesRoot, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, "package.json")));
}

function main() {
  const orphansByPackage = new Map();

  for (const packageDir of listPackageDirs()) {
    const orphans = findOrphans(packageDir);

    if (orphans.length > 0) {
      orphansByPackage.set(path.relative(workspaceRoot, packageDir), orphans);
    }
  }

  if (orphansByPackage.size === 0) {
    console.log("check-spec-coverage: every tracked *.spec.ts / *.test.ts file is reachable by its package's vitest include globs.");
    return 0;
  }

  console.error("check-spec-coverage: found spec/test files that no vitest include glob matches — they never run:\n");

  for (const [pkg, orphans] of orphansByPackage) {
    console.error(`  ${pkg}:`);

    for (const orphan of orphans) {
      console.error(`    ${path.relative(workspaceRoot, orphan)}`);
    }
  }

  console.error("\nEither widen that package's vitest.config.ts `include`, or move the file under a path the include already covers.");
  return 1;
}

process.exit(main());
