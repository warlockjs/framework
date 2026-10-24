/**
 * The oldest npm that re-resolves the `@warlock.js/*` family (and the
 * Vite/Vitest peer set) in an existing package-lock.json. npm 10.9 (the npm
 * bundled with Node 22.15) fails on it, so `warlock update` warns before it
 * installs with an older npm.
 */
export const MIN_NPM_VERSION = "11.6.2";

/**
 * Packages whose lock entries `warlock update` removes so that one install can
 * re-resolve them together: the framework family and the Vite/Vitest toolchain
 * whose peer set the family constrains.
 */
const PRUNED_PACKAGE =
  /^(@warlock\.js\/[^/]+|create-warlock|vite|vitest|@vitest\/[^/]+|@vitejs\/[^/]+)$/;

type LockEntry = Record<string, unknown>;

type NpmLockfile = {
  packages?: Record<string, LockEntry>;
  dependencies?: Record<string, LockEntry>;
  [key: string]: unknown;
};

/** The package name an npm lock `packages` key stands for (`node_modules/a/node_modules/@s/b` is `@s/b`). */
function packageNameOfKey(key: string): string | undefined {
  const marker = "node_modules/";
  const index = key.lastIndexOf(marker);

  return index < 0 ? undefined : key.slice(index + marker.length);
}

function pruneLegacyDependencies(
  dependencies: Record<string, LockEntry>,
  removed: Set<string>,
): void {
  for (const name of Object.keys(dependencies)) {
    if (PRUNED_PACKAGE.test(name)) {
      delete dependencies[name];
      removed.add(name);

      continue;
    }

    const nested = dependencies[name]?.dependencies;

    if (nested && typeof nested === "object") {
      pruneLegacyDependencies(nested as Record<string, LockEntry>, removed);
    }
  }
}

/**
 * Remove the framework family and the Vite/Vitest packages from a parsed
 * package-lock.json, nested copies included. The project's own `package.json`
 * ranges stay in the root entry, so a following `npm install` resolves
 * them again in one pass instead of stepping each exact peer pin on its own.
 * Returns the names removed (sorted); mutates `lockfile`.
 */
export function pruneFamilyLockEntries(lockfile: NpmLockfile): string[] {
  const removed = new Set<string>();

  if (lockfile.packages) {
    for (const key of Object.keys(lockfile.packages)) {
      const name = packageNameOfKey(key);

      if (name !== undefined && PRUNED_PACKAGE.test(name)) {
        delete lockfile.packages[key];
        removed.add(name);
      }
    }
  }

  if (lockfile.dependencies) pruneLegacyDependencies(lockfile.dependencies, removed);

  return [...removed].sort();
}

/** The `x.y.z` of an `npm --version` output, or `undefined`. */
export function parseNpmVersion(output: string): string | undefined {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1];
}

/** The warning printed when the npm in use is older than {@link MIN_NPM_VERSION}. */
export function oldNpmMessage(version: string): string {
  return (
    `npm ${version} cannot always re-resolve the @warlock.js family in an existing package-lock.json ` +
    `(ERESOLVE, or a crash on the Vite/Vitest peer set). Use npm ${MIN_NPM_VERSION} or newer, ` +
    `for example \`npx npm@${MIN_NPM_VERSION.split(".")[0]} install\`.`
  );
}
