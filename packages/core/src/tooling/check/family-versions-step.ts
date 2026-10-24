import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createProblem, type ToolingProblem } from "../problem";

/** One installed `@warlock.js/*` package. */
export type InstalledFamilyPackage = { name: string; version: string };

const SCOPE_DIRECTORY = path.join("node_modules", "@warlock.js");

/** The nearest `node_modules/@warlock.js` directory at or above `cwd`, if any. */
function findScopeDirectory(cwd: string): string | undefined {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, SCOPE_DIRECTORY);

    if (existsSync(candidate)) return candidate;

    if (path.dirname(dir) === dir) return undefined;
  }
}

/** Every `@warlock.js/*` package installed for the project at `cwd`, with its version. */
export function listInstalledFamilyPackages(cwd: string): InstalledFamilyPackage[] {
  const scopeDirectory = findScopeDirectory(cwd);

  if (!scopeDirectory) return [];

  const installed: InstalledFamilyPackage[] = [];

  for (const entry of readdirSync(scopeDirectory)) {
    try {
      const manifest: unknown = JSON.parse(
        readFileSync(path.join(scopeDirectory, entry, "package.json"), "utf8"),
      );
      const version =
        typeof manifest === "object" && manifest !== null
          ? Reflect.get(manifest, "version")
          : undefined;

      if (typeof version === "string") installed.push({ name: `@warlock.js/${entry}`, version });
    } catch {
      // not a package directory
    }
  }

  return installed.sort((left, right) => left.name.localeCompare(right.name));
}

/** `[major, minor, patch]` of a version, or `undefined` for a non-semver string. */
function versionParts(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);

  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function compare(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);

  if (!a || !b) return left.localeCompare(right);

  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);

    if (difference !== 0) return difference;
  }

  return 0;
}

/**
 * The `@warlock.js/*` packages are released in lockstep. Their peer
 * dependencies on each other are exact pins, so a mixed install means a
 * package was moved on its own. A `WL8010` problem names the
 * packages whose installed version differs from the newest one installed.
 */
export function checkFamilyVersions(cwd: string): ToolingProblem[] {
  const installed = listInstalledFamilyPackages(cwd);
  const versions = [...new Set(installed.map((entry) => entry.version))];

  if (versions.length <= 1) return [];

  const newest = [...versions].sort(compare).at(-1) ?? versions[0] ?? "";
  const behind = installed.filter((entry) => entry.version !== newest);
  const listing = behind.map((entry) => `${entry.name}@${entry.version}`).join(", ");

  return [
    createProblem({
      code: "WL8010",
      source: "environment",
      message: `Installed @warlock.js packages are on different versions: ${listing} differ from ${newest}. Run \`warlock update\` to move them all to one version.`,
    }),
  ];
}
