import { fileExistsAsync } from "@warlock.js/fs";
import { readFile } from "node:fs/promises";
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

/**
 * Detect the project's package manager from its lockfile, falling back to
 * npm when none is present. Shared by `warlock update` and `warlock add` so
 * both agree on a project that happens to carry more than one lockfile.
 */
export async function detectPackageManager(startDir: string = rootPath()): Promise<PackageManager> {
  const dirs: string[] = [];

  for (let dir = path.resolve(startDir); ; dir = path.dirname(dir)) {
    dirs.push(dir);

    if (path.dirname(dir) === dir) break;
  }

  // 1. nearest declared `packageManager` field
  for (const dir of dirs) {
    const declared = await readDeclaredPackageManager(dir);

    if (declared) return declared;
  }

  // 2. a pnpm workspace marker beats any (possibly stray) lockfile
  for (const dir of dirs) {
    if (await fileExistsAsync(path.join(dir, "pnpm-workspace.yaml"))) return "pnpm";
  }

  // 3. lockfiles, nearest level first
  for (const dir of dirs) {
    for (const { file, packageManager } of LOCKFILES) {
      if (await fileExistsAsync(path.join(dir, file))) return packageManager;
    }
  }

  const agent = process.env.npm_config_user_agent?.split("/")[0];

  if (agent === "pnpm" || agent === "yarn" || agent === "bun") return agent;

  return "npm";
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
