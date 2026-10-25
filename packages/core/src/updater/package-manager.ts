import { fileExistsAsync } from "@warlock.js/fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { rootPath } from "../utils";

/** Package managers the framework knows how to drive. */
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

/**
 * The lockfile that identifies each package manager, in detection order.
 * Bun is checked first because a Bun project may also carry a `yarn.lock`
 * (Bun writes one for tooling compatibility) — matching yarn there would run
 * the wrong installer against the wrong lockfile.
 */
const LOCKFILES: ReadonlyArray<{ file: string; packageManager: PackageManager }> = [
  { file: "bun.lock", packageManager: "bun" },
  { file: "bun.lockb", packageManager: "bun" },
  { file: "pnpm-lock.yaml", packageManager: "pnpm" },
  { file: "yarn.lock", packageManager: "yarn" },
  { file: "package-lock.json", packageManager: "npm" },
];

/** What {@link detectPackageManagerDetails} found. */
export type PackageManagerDetection = {
  packageManager: PackageManager;
  /**
   * The lockfiles found side by side when the choice had to be made between
   * them (no `packageManager` field, no install marker). Empty otherwise.
   */
  ambiguous: string[];
  /** One line saying why this manager was chosen, e.g. for the CLI to print. */
  reason: string;
};

/**
 * What each package manager leaves inside `node_modules` when it installs.
 * A stale lockfile or workspace file proves nothing about the last install;
 * these markers do.
 */
const INSTALL_MARKERS: ReadonlyArray<{ file: string; packageManager: PackageManager }> = [
  { file: ".package-lock.json", packageManager: "npm" },
  { file: ".pnpm", packageManager: "pnpm" },
  { file: ".modules.yaml", packageManager: "pnpm" },
  { file: ".yarn-state.yml", packageManager: "yarn" },
  { file: ".yarn-integrity", packageManager: "yarn" },
  { file: ".bun", packageManager: "bun" },
];

/**
 * Detect the project's package manager. The rule, in order:
 *
 * 1. the nearest `packageManager` field in a package.json;
 * 2. the manager that installed `node_modules` (npm `.package-lock.json`, pnpm
 *    `.pnpm` / `.modules.yaml`, yarn `.yarn-state.yml` / `.yarn-integrity`,
 *    bun `.bun`), because that is the lockfile actually in use;
 * 3. the nearest directory holding a lockfile: the one that covers every
 *    dependency in package.json, then `bun.lock` when present (Bun also writes
 *    a `yarn.lock`), otherwise the most recently modified. A stale
 *    `pnpm-workspace.yaml` never outranks a lockfile;
 * 4. a `pnpm-workspace.yaml` with no lockfile at all;
 * 5. the package manager running the CLI, then npm.
 *
 * `reason` always says which step decided.
 */
export async function detectPackageManagerDetails(
  startDir: string = rootPath(),
): Promise<PackageManagerDetection> {
  const dirs: string[] = [];

  for (let dir = path.resolve(startDir); ; dir = path.dirname(dir)) {
    dirs.push(dir);

    if (path.dirname(dir) === dir) break;
  }

  // 1. nearest declared `packageManager` field
  for (const dir of dirs) {
    const declared = await readDeclaredPackageManager(dir);

    if (declared) {
      return {
        packageManager: declared,
        ambiguous: [],
        reason: `the "packageManager" field in ${path.join(dir, "package.json")}`,
      };
    }
  }

  // 2. what installed node_modules
  let restrictTo: PackageManager[] | undefined;

  for (const dir of dirs) {
    const installed = await findInstallMarkers(dir);

    if (installed.length === 0) continue;

    const managers = [...new Set(installed.map((marker) => marker.packageManager))];
    const [only] = managers;

    if (managers.length === 1 && only) {
      return {
        packageManager: only,
        ambiguous: [],
        reason: `node_modules was installed by ${only} (${path.join(dir, "node_modules", installed[0]?.file ?? "")})`,
      };
    }

    restrictTo = managers;
    break;
  }

  // 3. lockfiles, nearest level first
  for (const dir of dirs) {
    let found = await findLockfiles(dir);

    if (restrictTo) {
      const allowed = found.filter((entry) => restrictTo?.includes(entry.packageManager));

      if (allowed.length > 0) found = allowed;
    }

    if (found.length > 0) return chooseLockfile(found, await readDependencyNames(dir), dir);
  }

  if (restrictTo?.[0]) {
    return {
      packageManager: restrictTo[0],
      ambiguous: [],
      reason: `node_modules carries markers from ${restrictTo.join(" and ")}; no lockfile to choose between them`,
    };
  }

  // 4. a workspace marker with no lockfile anywhere
  for (const dir of dirs) {
    if (await fileExistsAsync(path.join(dir, "pnpm-workspace.yaml"))) {
      return {
        packageManager: "pnpm",
        ambiguous: [],
        reason: `${path.join(dir, "pnpm-workspace.yaml")} exists and no lockfile was found`,
      };
    }
  }

  const agent = process.env.npm_config_user_agent?.split("/")[0];

  if (agent === "pnpm" || agent === "yarn" || agent === "bun") {
    return { packageManager: agent, ambiguous: [], reason: `the CLI was started by ${agent}` };
  }

  return {
    packageManager: "npm",
    ambiguous: [],
    reason: "no packageManager field, install marker or lockfile found; defaulting to npm",
  };
}

/**
 * Detect the project's package manager, falling back to npm when none is
 * present. Shared by `warlock update`, `warlock upgrade` and `warlock add` so
 * they agree on a project that happens to carry more than one lockfile.
 */
export async function detectPackageManager(startDir: string = rootPath()): Promise<PackageManager> {
  return (await detectPackageManagerDetails(startDir)).packageManager;
}

/** A lockfile found in one directory, with when it was last written. */
type FoundLockfile = { file: string; packageManager: PackageManager; modifiedAt: number };

async function findLockfiles(dir: string): Promise<FoundLockfile[]> {
  const found: FoundLockfile[] = [];

  for (const { file, packageManager } of LOCKFILES) {
    try {
      found.push({ file, packageManager, modifiedAt: (await stat(path.join(dir, file))).mtimeMs });
    } catch {
      // not present
    }
  }

  return found;
}

async function findInstallMarkers(dir: string) {
  const found: Array<{ file: string; packageManager: PackageManager }> = [];

  for (const marker of INSTALL_MARKERS) {
    if (await fileExistsAsync(path.join(dir, "node_modules", marker.file))) found.push(marker);
  }

  return found;
}

/** The direct dependency names in the directory's package.json, if readable. */
async function readDependencyNames(dir: string): Promise<string[]> {
  try {
    const json = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));

    return Object.keys({
      ...json.dependencies,
      ...json.devDependencies,
      ...json.optionalDependencies,
    });
  } catch {
    return [];
  }
}

/** Whether the lockfile mentions every direct dependency of package.json. */
async function lockfileCovers(dir: string, file: string, names: string[]): Promise<boolean> {
  if (names.length === 0) return true;

  try {
    const content = await readFile(path.join(dir, file), "utf8");

    return names.every((name) => content.includes(name));
  } catch {
    // binary (bun.lockb) or unreadable: cannot tell, so do not rule it out
    return true;
  }
}

async function chooseLockfile(
  found: FoundLockfile[],
  dependencyNames: string[],
  dir: string,
): Promise<PackageManagerDetection> {
  const [first] = found;

  if (!first) return { packageManager: "npm", ambiguous: [], reason: "defaulting to npm" };

  if (found.length === 1) {
    return {
      packageManager: first.packageManager,
      ambiguous: [],
      reason: `${first.file} is the only lockfile`,
    };
  }

  const names = found.map((entry) => entry.file);
  const consistent: FoundLockfile[] = [];

  for (const entry of found) {
    if (await lockfileCovers(dir, entry.file, dependencyNames)) consistent.push(entry);
  }

  const pool = consistent.length > 0 ? consistent : found;
  const [poolFirst] = pool;

  if (pool.length === 1 && poolFirst) {
    return {
      packageManager: poolFirst.packageManager,
      ambiguous: names,
      reason: `${poolFirst.file} is the only lockfile that matches package.json (found ${names.join(", ")})`,
    };
  }

  const bun = pool.find((entry) => entry.packageManager === "bun");

  if (bun) {
    return {
      packageManager: "bun",
      ambiguous: names,
      reason: `${bun.file} is present (Bun also writes a yarn.lock; found ${names.join(", ")})`,
    };
  }

  // Stable sort: on equal times the LOCKFILES order decides.
  const newest = [...pool].sort((a, b) => b.modifiedAt - a.modifiedAt)[0] ?? first;

  return {
    packageManager: newest.packageManager,
    ambiguous: names,
    reason: `${newest.file} is the most recently written of ${names.join(", ")}`,
  };
}

/** The manager named by the app's `packageManager` field, if any. */
async function readDeclaredPackageManager(dir: string): Promise<PackageManager | undefined> {
  try {
    const json = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
    const name = String(json.packageManager ?? "").split("@")[0];

    if (name === "pnpm" || name === "yarn" || name === "bun" || name === "npm") return name;
  } catch {
    // no readable package.json — fall through to lockfiles
  }

  return undefined;
}

/**
 * The lockfile-syncing install command for the given manager. No package
 * arguments — `warlock update` rewrites the versions in package.json first,
 * then a plain install reconciles `node_modules` to match.
 */
export function getInstallCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "yarn":
      return "yarn install";

    case "pnpm":
      return "pnpm install";

    case "bun":
      return "bun install";

    default:
      return "npm install";
  }
}

/**
 * The command that installs *specific* packages — what `warlock add` needs.
 * Distinct from {@link getInstallCommand}, which only reconciles what is
 * already written into package.json.
 */
export function getAddCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "yarn":
      return "yarn add";

    case "pnpm":
      return "pnpm add";

    case "bun":
      return "bun add";

    default:
      return "npm install";
  }
}

/**
 * The package-manager command that saves an exact version. Warlock family
 * dependencies use this path so the version selected by the executing Core is
 * preserved verbatim in package.json instead of being widened by a manager's
 * default save prefix.
 */
export function getExactAddCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "yarn":
      return "yarn add --exact";

    case "pnpm":
      return "pnpm add --save-exact";

    case "bun":
      return "bun add --exact";

    default:
      return "npm install --save-exact";
  }
}
