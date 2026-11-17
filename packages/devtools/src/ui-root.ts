import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedUiRoot: string | undefined;

/**
 * Whether `dir` is this package's root: it has the built dashboard
 * (`ui/dashboard/index.html`) or, before the first build, the Processes panel
 * view (`ui/panels/processes.js`), beside a `package.json` named
 * `@warlock.js/devtools`.
 */
function isPackageRoot(dir: string): boolean {
  const hasUi =
    existsSync(path.join(dir, "ui", "dashboard", "index.html")) ||
    existsSync(path.join(dir, "ui", "panels", "processes.js"));
  const packageJson = path.join(dir, "package.json");

  if (!hasUi || !existsSync(packageJson)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as { name?: string };
    return parsed.name === "@warlock.js/devtools";
  } catch {
    return false;
  }
}

/**
 * Locate this package's `ui/` directory by walking up from the current
 * module's directory. Works from `src/` in development and from the built
 * `esm/`/`cjs/` output, since both sit beside `ui/` and `package.json` at
 * the package root.
 */
export function resolveUiRoot(): string {
  if (cachedUiRoot) {
    return cachedUiRoot;
  }

  let dir = path.dirname(fileURLToPath(import.meta.url));

  while (true) {
    if (isPackageRoot(dir)) {
      cachedUiRoot = path.join(dir, "ui");
      return cachedUiRoot;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        "Could not locate the devtools UI directory: no ancestor of " +
          "this module has ui/dashboard/index.html or ui/panels/processes.js beside a package.json named " +
          "@warlock.js/devtools.",
      );
    }

    dir = parent;
  }
}
