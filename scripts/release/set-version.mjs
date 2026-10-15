#!/usr/bin/env node
/**
 * Move the whole @warlock.js family to one new version.
 *
 *   pnpm release:version 5.30.0
 *   pnpm release:version 5.30.0 --no-lockfile
 *
 * The family is released in lockstep, so every member must already share one
 * version; this sets all of them to the next one. It also moves the exact
 * family pins (`"@warlock.js/core": "5.29.0"` in a peer or optional
 * dependency) along with them, keeping any `^`/`~` prefix. `*` and
 * `workspace:` specs are left alone: they never name a version.
 *
 * The create-warlock app template is moved too. Its framework dependencies
 * normally hold the placeholder `0.0.0-set-by-scaffolder`, which the
 * scaffolder replaces with its own (now bumped) version at scaffold time; any
 * real family pin at the current version found in a template manifest is
 * moved with the rest, so a hard-coded pin can never be left behind.
 *
 * Members are read from tools/release/pkgist.config.ts, the same list the
 * release workflow checks. Manifests are edited as text so their formatting
 * and line endings survive. Afterwards the lockfile is refreshed with
 * `pnpm install --lockfile-only`, because CI installs with --frozen-lockfile
 * and an exact pin is recorded there.
 *
 * Refuses, naming what was wrong, when the version is not exact semver, is not
 * newer than the current one, or when the members disagree on the current one.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PKGIST_CONFIG = path.join(root, "tools", "release", "pkgist.config.ts");
const TEMPLATES = path.join(root, "packages", "create-warlock", "templates");
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** Member directories (`packages/<name>`), as the release workflow derives them. */
export function readMemberDirs(configText) {
  const dirs = [...configText.matchAll(/root: "\.\.\/\.\.\/(packages\/[a-z0-9-]+)"/g)].map(
    (match) => match[1],
  );

  return [...new Set(dirs)];
}

/** -1, 0 or 1 for two exact semver strings. */
export function compareVersions(a, b) {
  const left = a.match(SEMVER).slice(1).map(Number);
  const right = b.match(SEMVER).slice(1).map(Number);

  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }

  return 0;
}

function escapeVersion(version) {
  return version.replaceAll(".", "\\.");
}

/** Move only the family pins at `current`; the manifest's own version is untouched. */
export function bumpFamilyPins(text, current, next) {
  const familyPin = new RegExp(
    `("(?:@warlock\\.js/[a-z0-9-]+|create-warlock)"\\s*:\\s*")([~^]?)${escapeVersion(current)}(")`,
    "g",
  );

  return text.replace(familyPin, `$1$2${next}$3`);
}

/**
 * Return the manifest text with its version and its exact family pins moved
 * from `current` to `next`. Throws when the top-level version is not `current`.
 */
export function bumpManifest(text, current, next) {
  const manifest = JSON.parse(text);

  if (manifest.version !== current) {
    throw new Error(`${manifest.name} is at ${manifest.version}, expected ${current}`);
  }

  const versionLine = new RegExp(`("version"\\s*:\\s*")${escapeVersion(current)}(")`);
  const updated = bumpFamilyPins(text.replace(versionLine, `$1${next}$2`), current, next);

  if (JSON.parse(updated).version !== next) {
    throw new Error(`${manifest.name}: could not rewrite its version line`);
  }

  return updated;
}

/** Every package.json under the create-warlock templates. */
function templateManifests(dir = TEMPLATES) {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : templateManifests(full);
    }

    return entry.name === "package.json" ? [full] : [];
  });
}

function fail(message) {
  console.error(`release:version: ${message}`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const next = args.find((arg) => !arg.startsWith("--"));
  const updateLockfile = !args.includes("--no-lockfile");
  const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--no-lockfile");

  if (unknown.length > 0) {
    fail(`unknown option ${unknown.join(", ")}`);
  }

  if (!next || !SEMVER.test(next)) {
    fail(`expected an exact version such as 5.30.0, got "${next ?? ""}"`);
  }

  const dirs = readMemberDirs(readFileSync(PKGIST_CONFIG, "utf8"));

  if (dirs.length === 0) {
    fail(`no members found in ${path.relative(root, PKGIST_CONFIG)}`);
  }

  const members = dirs.map((dir) => {
    const file = path.join(root, dir, "package.json");
    const text = readFileSync(file, "utf8");

    return { dir, file, text, version: JSON.parse(text).version };
  });

  const versions = new Set(members.map((member) => member.version));

  if (versions.size !== 1) {
    const listing = members.map((member) => `  ${member.dir}: ${member.version}`).join("\n");
    fail(`the family must share one version before a bump, found:\n${listing}`);
  }

  const [current] = versions;

  if (compareVersions(next, current) <= 0) {
    fail(`${next} is not newer than the current ${current}`);
  }

  for (const member of members) {
    writeFileSync(member.file, bumpManifest(member.text, current, next));
  }

  console.log(`release:version: ${members.length} packages moved from ${current} to ${next}`);

  for (const file of templateManifests()) {
    const text = readFileSync(file, "utf8");
    const updated = bumpFamilyPins(text, current, next);
    const relative = path.relative(root, file);

    if (updated !== text) {
      writeFileSync(file, updated);
      console.log(`release:version: moved the pinned framework versions in ${relative}`);
    } else {
      console.log(`release:version: ${relative} pins no framework version (the scaffolder sets it)`);
    }
  }

  if (updateLockfile) {
    // One command string through the shell: pnpm is a .cmd shim on Windows.
    const result = spawnSync("pnpm install --lockfile-only", {
      cwd: root,
      stdio: "inherit",
      shell: true,
    });

    if (result.status !== 0) {
      fail("the manifests are updated, but `pnpm install --lockfile-only` failed; rerun it");
    }
  }

  console.log(
    `Next: date each package's "## ${next}" CHANGELOG heading, commit, push, ` +
      "then run the release workflow with this version.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
