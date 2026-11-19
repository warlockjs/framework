import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The app's own name and version, as the dashboard shows them at the bottom of the sidebar. */
export type DevtoolsAppInfo = { name: string; version: string };

/** The `version` of a `package.json` named `name`, or `null` when the file is not that package's. */
function versionIn(file: string, name: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(file, "utf8")) as {
      name?: unknown;
      version?: unknown;
    };

    return manifest.name === name && typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * The installed version of a package, read from its `package.json` without
 * going through its `exports` (published `@warlock.js/core` exports neither
 * `./package.json` nor a `require` condition). It resolves the package's entry
 * and walks up to the `package.json` with that name; when the entry cannot be
 * resolved, it looks in each `node_modules` above `from`. `null` when unknown.
 */
export function installedVersion(
  name: string,
  from: string,
  resolve: ((specifier: string) => string) | undefined,
): string | null {
  try {
    const entry = resolve?.(name);

    if (entry !== undefined) {
      let folder = path.dirname(entry.startsWith("file:") ? fileURLToPath(entry) : entry);

      for (;;) {
        const version = versionIn(path.join(folder, "package.json"), name);

        if (version !== null) return version;

        const parent = path.dirname(folder);

        if (parent === folder) break;

        folder = parent;
      }
    }
  } catch {
    // Not resolvable from here: look in the node_modules folders below.
  }

  for (let folder = from; ; folder = path.dirname(folder)) {
    const version = versionIn(
      path.join(folder, "node_modules", ...name.split("/"), "package.json"),
      name,
    );

    if (version !== null) return version;
    if (path.dirname(folder) === folder) return null;
  }
}

/**
 * The app's `name` and `version` from the `package.json` in `root`. Only these
 * two strings are read; `null` when the file is missing, unreadable or lacks
 * either one.
 */
export function readAppInfo(root: string): DevtoolsAppInfo | null {
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
    };

    if (
      typeof manifest.name !== "string" ||
      typeof manifest.version !== "string" ||
      manifest.name === "" ||
      manifest.version === ""
    ) {
      return null;
    }

    return { name: manifest.name.slice(0, 100), version: manifest.version.slice(0, 50) };
  } catch {
    return null;
  }
}

type Versions = { warlockVersion: string | null; app: DevtoolsAppInfo | null };

let cached: Versions | undefined;

/**
 * The installed `@warlock.js/core` version and the app's name and version,
 * read once per process (`root` defaults to the working directory) and kept.
 */
export function readVersions(root: string = process.cwd()): Versions {
  cached ??= {
    warlockVersion: installedVersion(
      "@warlock.js/core",
      root,
      typeof import.meta.resolve === "function"
        ? (specifier: string) => import.meta.resolve(specifier)
        : undefined,
    ),
    app: readAppInfo(root),
  };

  return cached;
}

/** Forgets the cached versions (for tests). */
export function resetVersionsCache(): void {
  cached = undefined;
}
