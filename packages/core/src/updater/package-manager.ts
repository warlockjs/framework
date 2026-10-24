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
   * them (no `packageManager` field, no workspace marker). Empty otherwise.
   */
  ambiguous: string[];
};

/**
 * Detect the project's package manager. The rule, in order:
 *
 * 1. the nearest `packageManager` field in a package.json;
 * 2. a `pnpm-workspace.yaml` (its `pnpm-lock.yaml` wins over compatibility lockfiles);
 * 3. the nearest directory holding a lockfile: the only one, `bun.lock` when
 *    present (Bun also writes a `yarn.lock`), otherwise the most recently
 *    modified, because the lockfile the project installs with is the one its
 *    package manager rewrites;
 * 4. the package manager running the CLI, then npm.
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

    if (declared) return { packageManager: declared, ambiguous: [] };
  }

  // 2. a workspace governs descendants, but its own real lockfile wins over a marker
  for (const dir of dirs) {
    if (await fileExistsAsync(path.join(dir, "pnpm-workspace.yaml"))) {
      if (await fileExistsAsync(path.join(dir, "pnpm-lock.yaml"))) {
        return { packageManager: "pnpm", ambiguous: [] };
      }

      const found = await findLockfiles(dir);

      return found.length > 0 ? chooseLockfile(found) : { packageManager: "pnpm", ambiguous: [] };
    }
  }

  // 3. lockfiles, nearest level first
  for (const dir of dirs) {
    const found = await findLockfiles(dir);

    if (found.length > 0) return chooseLockfile(found);
  }

  const agent = process.env.npm_config_user_agent?.split("/")[0];

  if (agent === "pnpm" || agent === "yarn" || agent === "bun") {
    return { packageManager: agent, ambiguous: [] };
  }

  return { packageManager: "npm", ambiguous: [] };
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

function chooseLockfile(found: FoundLockfile[]): PackageManagerDetection {
  const [first] = found;

  if (!first) return { packageManager: "npm", ambiguous: [] };

  if (found.length === 1) return { packageManager: first.packageManager, ambiguous: [] };

  const names = found.map((entry) => entry.file);
  const bun = found.find((entry) => entry.packageManager === "bun");

  if (bun) return { packageManager: "bun", ambiguous: names };

  // Stable sort: on equal times the LOCKFILES order decides.
  const newest = [...found].sort((a, b) => b.modifiedAt - a.modifiedAt)[0] ?? first;

  return { packageManager: newest.packageManager, ambiguous: names };
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
