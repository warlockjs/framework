import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedUiRoot: string | undefined;

/** Whether `dir` is this package's root: it has `ui/index.html` beside a `package.json` named `@warlock.js/devtools`. */
function isPackageRoot(dir: string): boolean {
  const indexHtml = path.join(dir, "ui", "index.html");
  const packageJson = path.join(dir, "package.json");

  if (!existsSync(indexHtml) || !existsSync(packageJson)) {
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
          "this module has a ui/index.html beside a package.json named " +
          "@warlock.js/devtools.",
      );
    }

    dir = parent;
  }
}
