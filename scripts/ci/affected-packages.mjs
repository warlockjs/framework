#!/usr/bin/env node
/**
 * Decide which workspace packages a CI run must check.
 *
 *   node scripts/ci/affected-packages.mjs [--base <git-ref>] [--all]
 *
 * With `--all` (or no `--base`), every package under `packages/` is selected.
 * With `--base`, the packages whose files changed since the merge base are
 * selected, together with every package that depends on them (transitively),
 * because a change to `core` can break `auth` without touching a file in it.
 * A change to anything that shapes the whole workspace (the lockfile, the root
 * manifest, the shared tsconfig, this script, the CI workflow) selects every
 * package.
 *
 * Prints a JSON array of `{ dir, name }` and, on GitHub Actions, writes
 * `matrix` and `count` to $GITHUB_OUTPUT.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Root files whose change can affect any package. */
const WORKSPACE_WIDE = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig\.base\.json$/,
  /^\.npmrc$/,
  /^scripts\/ci\//,
  /^\.github\/workflows\/ci\.yml$/,
];

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function parseArgs(argv) {
  const options = { base: undefined, all: false };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--base") {
      options.base = argv[++index];

      if (!options.base) {
        throw new Error("--base needs a git ref");
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

/** Package directories from the workspace manifest, `packages/` only (docs has its own workflow). */
function readPackageDirs() {
  const manifest = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
  const dirs = [];
  let inPackages = false;

  for (const line of manifest.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }

    if (inPackages && /^\S/.test(line)) {
      break;
    }

    const match = inPackages ? line.match(/^\s+-\s+['"]?([^'"]+?)['"]?\s*$/) : null;

    if (match && match[1].startsWith("packages/")) {
      dirs.push(match[1]);
    }
  }

  return dirs;
}

function readPackages() {
  return readPackageDirs()
    .filter((dir) => existsSync(path.join(root, dir, "package.json")))
    .map((dir) => {
      const manifest = JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8"));
      const dependencies = new Set(
        DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})),
      );

      return { dir, name: manifest.name, dependencies };
    });
}

function changedFiles(base) {
  const output = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    cwd: root,
    encoding: "utf8",
  });

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Add every package that depends, directly or not, on one already selected. */
function withDependents(selected, packages) {
  const names = new Set(selected.map((pkg) => pkg.name));
  let grew = true;

  while (grew) {
    grew = false;

    for (const pkg of packages) {
      if (names.has(pkg.name)) {
        continue;
      }

      if ([...pkg.dependencies].some((dependency) => names.has(dependency))) {
        names.add(pkg.name);
        grew = true;
      }
    }
  }

  return packages.filter((pkg) => names.has(pkg.name));
}

function select(options, packages) {
  if (options.all || !options.base) {
    return packages;
  }

  const files = changedFiles(options.base);

  if (files.some((file) => WORKSPACE_WIDE.some((pattern) => pattern.test(file)))) {
    return packages;
  }

  const touched = packages.filter((pkg) => files.some((file) => file.startsWith(`${pkg.dir}/`)));

  return withDependents(touched, packages);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packages = readPackages();

  if (packages.length === 0) {
    throw new Error("pnpm-workspace.yaml lists no packages under packages/");
  }

  const matrix = select(options, packages).map(({ dir, name }) => ({ dir, name }));

  console.log(JSON.stringify(matrix, null, 2));

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `matrix=${JSON.stringify(matrix)}\ncount=${matrix.length}\n`,
    );
  }
}

main();
