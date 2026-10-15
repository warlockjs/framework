import { fileURLToPath, pathToFileURL, URL } from "node:url";

/**
 * The framework's own ESM `resolve()` core — the Phase B replacement for
 * delegating resolution to tsx.
 *
 * Scope by design: it owns exactly what Node's default resolver cannot do
 * (TypeScript extension/`index` probing and tsconfig `paths` aliases). For
 * anything else — bare npm packages, `node:` builtins, `file:`/`data:`
 * specifiers — it returns `null`, meaning "not mine, fall through to the
 * next resolver" (Node default, which already honours `node_modules` and
 * package `exports`). That keeps the risky surface minimal: we only have
 * to reproduce tsx's TS-path behaviour, not re-implement npm resolution.
 *
 * Pure and dependency-injected (`pathsMatcher`, `fileExists`) so the whole
 * thing is unit-testable and verifiable against the captured tsx-4.21
 * golden fixture without booting.
 */

export type PathsMatcher = (specifier: string) => string[];
export type FileExists = (absolutePath: string) => boolean;

/**
 * Extension/`index` probing for one candidate base path, mirroring tsx's
 * TypeScript-aware order:
 *
 * 1. exact (if it already has a real extension that exists)
 * 2. `.js`/`.jsx`/`.mjs`/`.cjs` specifier → the TS source it compiles from
 *    (`.ts`/`.tsx`) — the standard "import the .js, ship the .ts" ESM style
 * 3. append `.ts`, `.tsx`, `.js`, `.jsx`, `.json`
 * 4. directory index: `<dir>/index.{ts,tsx,js,jsx}`
 *
 * Returns the resolved absolute path, or `null` if nothing exists.
 */
export function probeFile(basePath: string, fileExists: FileExists): string | null {
  // 2. `.js` → `.ts`/`.tsx` rewrite (checked before the literal .js so a
  //    co-located source wins, matching tsx).
  const jsRewrite = basePath.match(/\.(js|jsx|mjs|cjs)$/);
  if (jsRewrite) {
    const stem = basePath.slice(0, -jsRewrite[0].length);
    for (const ext of [".ts", ".tsx"]) {
      if (fileExists(stem + ext)) return stem + ext;
    }
  }

  // 1. exact (real extension already present and on disk)
  if (/\.[a-z]+$/i.test(basePath) && fileExists(basePath)) {
    return basePath;
  }

  // 3. append source/asset extensions
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ".json"]) {
    if (fileExists(basePath + ext)) return basePath + ext;
  }

  // 4. directory index
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const candidate = `${basePath}/index${ext}`;
    if (fileExists(candidate)) return candidate;
  }

  return null;
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/**
 * Resolve `specifier` to a `file://` URL we own, or `null` to fall through
 * to the next resolver.
 *
 * @param specifier  - The import specifier.
 * @param parentURL  - Importing module's URL (already `?v=N`-stripped).
 * @param pathsMatcher - `get-tsconfig` paths matcher (alias → candidates).
 * @param fileExists - Existence probe (injected for testing).
 */
export function ownResolve(
  specifier: string,
  parentURL: string | undefined,
  pathsMatcher: PathsMatcher | null,
  fileExists: FileExists,
): string | null {
  // Not ours: builtins and already-formed URLs (config-loader imports by
  // file: URL). Node default handles these.
  if (
    specifier.startsWith("node:") ||
    specifier.startsWith("file:") ||
    specifier.startsWith("data:")
  ) {
    return null;
  }

  // Relative / absolute path imports → probe against the parent's dir.
  if (isRelative(specifier) || specifier.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(specifier)) {
    if (!parentURL) return null;
    const base = fileURLToPath(new URL(specifier, parentURL));
    const hit = probeFile(base.replace(/\\/g, "/"), fileExists);
    return hit ? pathToFileURL(hit).href : null;
  }

  // Bare / aliased: try tsconfig `paths`. Each candidate is probed; the
  // first that exists on disk wins. If none do (e.g. a real npm package
  // whose name happened to match a baseUrl guess), return null so Node
  // default resolves it from node_modules with full `exports` support.
  if (pathsMatcher) {
    for (const candidate of pathsMatcher(specifier)) {
      const hit = probeFile(candidate.replace(/\\/g, "/"), fileExists);
      if (hit) return pathToFileURL(hit).href;
    }
  }

  return null;
}
