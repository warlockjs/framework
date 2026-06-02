import { createPathsMatcher, getTsconfig } from "get-tsconfig";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ownResolve, type PathsMatcher } from "./own-resolver.js";
import { captureResolution } from "./resolve-capture.js";
import { getVersion } from "./version-registry.js";

/**
 * The `file://` URL prefix for the project's `src/` root, set once during
 * `initialize()`. Used to identify which resolved URLs belong to user code.
 */
let srcRootUrl = "";

/**
 * Configure the source root used by the resolve hook.
 * Must be called from `initialize()` before any imports are resolved.
 *
 * @param srcRoot - Absolute filesystem path to the project `src/` directory.
 */
export function setSrcRoot(srcRoot: string): void {
  srcRootUrl = pathToFileURL(srcRoot).href + "/";
}

/** Lazily-built tsconfig `paths` matcher (worker has no startup hook). */
let pathsMatcher: PathsMatcher | null = null;
let pathsMatcherBuilt = false;

function getPathsMatcher(): PathsMatcher | null {
  if (pathsMatcherBuilt) return pathsMatcher;
  pathsMatcherBuilt = true;
  const tsconfig = getTsconfig(process.cwd());
  pathsMatcher = tsconfig ? createPathsMatcher(tsconfig) : null;
  return pathsMatcher;
}

type ResolveContext = {
  parentURL?: string;
  conditions?: string[];
  importAttributes?: Record<string, string>;
};

type ResolveResult = {
  url: string;
  format?: string;
  shortCircuit?: boolean;
};

type NextResolve = (specifier: string, context?: ResolveContext) => Promise<ResolveResult>;

/**
 * ESM loader `resolve()` hook.
 *
 * The framework's own resolver (`ownResolve`) handles tsconfig `paths`,
 * aliases, and TS extension/`index` probing. Specifiers it doesn't own
 * (bare npm, `node:`, `file:`) fall through to `nextResolve` (Node
 * default). After resolution, stamps a `?v=<N>` version token onto any
 * `.ts` / `.tsx` file that lives under the configured `src/` root.
 *
 * The version token is the cache-bust mechanism: when a file changes the main
 * thread bumps its counter, the next `import()` produces a new URL, Node sees
 * a cache miss, and loads fresh content — native ESM cycles are preserved
 * because static imports remain static throughout.
 *
 * **parentURL cleaning**: the resolved URL carries `?v=N` as a suffix. If a
 * module loaded this way statically imports a relative sibling, Node uses that
 * `?v=N` URL as the `parentURL` for the next `resolve()` call. Passing it
 * unmodified to `nextResolve()` causes tsx to produce paths like
 * `some-sibling.ts?v=0` (the query leaks into URL joining). We strip `?v=N`
 * from `parentURL` before forwarding to prevent this.
 *
 * @example
 * // First import of user.model.ts → ?v=0
 * // File watcher bumps → next import → ?v=1 → fresh module
 */
export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
): Promise<ResolveResult> {
  const cleanContext =
    context.parentURL?.includes("?v=")
      ? { ...context, parentURL: context.parentURL.replace(/\?v=\d+$/, "") }
      : context;

  // The framework's own resolver owns tsconfig `paths` + TS
  // extension/index probing. Anything it returns `null` for (bare npm,
  // `node:`, `file:`) falls through to Node default via `nextResolve`.
  const owned = ownResolve(
    specifier,
    cleanContext.parentURL,
    getPathsMatcher(),
    existsSync,
  );
  // When we produced the URL ourselves we did NOT call nextResolve, so the
  // result must short-circuit the loader chain or Node throws
  // ERR_LOADER_CHAIN_INCOMPLETE (e.g. for @warlock.js/* .ts that resolve
  // outside the project src root and hit the early return below).
  const result: ResolveResult = owned
    ? { url: owned, shortCircuit: true }
    : await nextResolve(specifier, cleanContext);

  const { url } = result;

  // Ground-truth recorder (no-op unless WARLOCK_RESOLVE_CAPTURE is set):
  // logs the answer for this (specifier, parentURL) so the Phase B
  // resolver can be proven to reproduce tsx exactly.
  captureResolution({
    specifier,
    parentURL: cleanContext.parentURL,
    url,
    format: result.format,
  });

  const cleanUrl = url.replace(/\?v=\d+$/, "");

  if (
    !cleanUrl.startsWith(srcRootUrl) ||
    (!cleanUrl.endsWith(".ts") && !cleanUrl.endsWith(".tsx"))
  ) {
    return result;
  }

  const absolutePath = fileURLToPath(cleanUrl);
  const version = getVersion(absolutePath);

  // Spread the full result from nextResolve (preserves `format` and any other
  // fields tsx sets) and only override `url`. Dropping `format` would cause
  // tsx's load hook to see an undefined format and fall through to Node's
  // default loader, which rejects unknown extensions like .tsx.
  return { ...result, url: `${cleanUrl}?v=${version}`, shortCircuit: true };
}
