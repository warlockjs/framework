import { fileExistsAsync } from "@warlock.js/fs";
import { rootPath } from "../utils";

/** Package managers the framework knows how to drive. */
export type PackageManager = "npm" | "yarn" | "pnpm";

/**
 * Detect the project's package manager from its lockfile, falling back to
 * npm when none is present. The lookup order matches `warlock add`, so both
 * commands agree on a project that happens to carry more than one lockfile.
 */
export async function detectPackageManager(): Promise<PackageManager> {
  if (await fileExistsAsync(rootPath("package-lock.json"))) {
    return "npm";
  }

  if (await fileExistsAsync(rootPath("yarn.lock"))) {
    return "yarn";
  }

  if (await fileExistsAsync(rootPath("pnpm-lock.yaml"))) {
    return "pnpm";
  }

  return "npm";
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

    default:
      return "npm install";
  }
}
