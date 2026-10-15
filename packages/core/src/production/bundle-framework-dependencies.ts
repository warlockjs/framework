import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import type { Plugin } from "esbuild";

/**
 * The package name a bare specifier addresses, discarding any subpath:
 * `ajv/dist/jtd` → `ajv`, `@fastify/static/lib/x` → `@fastify/static`.
 */
export function packageNameOfSpecifier(specifier: string): string {
  const segments = specifier.split("/");

  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? specifier);
}

/**
 * A specifier Node would resolve through `node_modules` — not a path. Both
 * separators are rejected because esbuild hands plugins Windows paths as
 * written, and `path.isAbsolute` is what catches a drive-letter root.
 */
export function isBareSpecifier(specifier: string): boolean {
  return (
    specifier.length > 0 &&
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("\\") &&
    !path.isAbsolute(specifier)
  );
}

/**
 * The `dependencies` of the package that owns `file`, or `undefined` when the
 * walk reaches the filesystem root without finding a package.
 *
 * **The nearest `package.json` is not necessarily the owner.** Packages
 * publish TYPE-MARKER manifests — `glob/dist/commonjs/package.json` is the
 * two-line `{"type":"commonjs"}` that tells Node how to read the files beside
 * it — and a walk that stops at the first `package.json` it sees stops there,
 * reads no `dependencies`, and concludes the package declares nothing. Every
 * import from such a directory is then judged undeclared: `glob`'s own
 * `require("path-scurry")` was left external and the built app died on it at
 * startup. A manifest with no `name` is not a package, so the walk continues
 * past it.
 */
function findOwningDependencies(file: string): ReadonlySet<string> | undefined {
  let dir = path.dirname(file);

  for (;;) {
    const manifestPath = path.join(dir, "package.json");

    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
          name?: string;
          dependencies?: Record<string, string>;
        };

        if (typeof manifest.name === "string" && manifest.name.length > 0) {
          return new Set(Object.keys(manifest.dependencies ?? {}));
        }
      } catch {
        // An unreadable or malformed manifest is not evidence about
        // anything. Keep walking; the enclosing package may still answer.
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Whether `file` is code the APP owns — inside the app root and not inside
 * any `node_modules` below it. A file under `node_modules` is a package's
 * code that happens to sit beneath the app directory, which is the opposite
 * of what this asks.
 */
function isAppOwnedFile(file: string, appRoot: string): boolean {
  const relative = path.relative(appRoot, file);

  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;

  return !relative.split(/[\\/]/).includes("node_modules");
}

/**
 * Decide, per import edge, whether a bare specifier stays a bare specifier in
 * the emitted bundle or is bundled into it.
 *
 * **The defect.** The bundler ran `packages: "external"`, so EVERY bare
 * specifier survived verbatim into an artifact that Node then resolves from
 * the artifact's own location — inside the app's `dist/`. That is right for
 * the app's own dependencies and wrong for everything else, because the
 * bundle does not contain only app code: `buildAliasMapFromTsconfig` maps
 * `@warlock.js/*` onto its on-disk SOURCE (mandatory — those packages have
 * no built output in a source checkout, canon `5f684f28`), so the framework's
 * own compiled source is inlined into the app's bundle, and with it the bare
 * `@fastify/http-proxy`, `find-my-way`, `fast-jwt` and `@mongez/*` imports it
 * makes. The app never declared any of those. Under npm/yarn hoisting they
 * resolve by accident; under a strict pnpm tree the built app cannot boot.
 *
 * `assertGeneratedImports` already refuses this for the code the builder
 * GENERATES. This is the same rule for the framework source that generated
 * code pulls in — the half no assertion could reach, because rewriting the
 * import is not an option there: the framework is entitled to its own
 * dependencies.
 *
 * **The rule.** A bare specifier is external — today's behaviour, unchanged —
 * unless BOTH of:
 *
 * 1. the importer is not app-owned code, and
 * 2. the specifier names a package the importer's OWN package declares in
 *    `dependencies`.
 *
 * Then it is bundled, and esbuild resolves it from the importer, which is the
 * only resolution that can be correct: `@fastify/ajv-compiler` needs ajv 8
 * while another dependent needs ajv 6, and under pnpm each has its own nested
 * copy. A flat `alias` map cannot express that — it collapses a name to one
 * target for the whole build and produces exactly the "Could not resolve
 * ajv/dist/jtd" class of failure. Resolving per edge is not an optimisation
 * here; it is the difference between working and not.
 *
 * Condition 2 is what keeps canon `5f684f28` intact. An optional peer reached
 * through `await import(...)` — `nodemailer`, `socket.io`, `vite`, the AI
 * SDKs — is declared as a `peerDependency`, never a `dependency`, precisely
 * because it may not be installed at all. Reading only `dependencies` leaves
 * every one of them external without needing a list of their names to
 * maintain, which is the failure mode a hand-written exclusion list has.
 *
 * Transitivity falls out rather than being coded: once `@fastify/http-proxy`
 * is bundled, IT is a non-app-owned importer, so its own `@fastify/reply-from`
 * dependency is judged by the same two conditions and resolved from
 * http-proxy's directory — the nested copy Node itself would have loaded.
 */
export function bundleFrameworkDependencies(options: {
  appRoot: string;
  /**
   * The keys of the esbuild `alias` map this same build is configured with.
   *
   * They MUST be excluded here, and the reason is a trap worth naming: an
   * `onResolve` callback pre-empts esbuild's built-in resolver, and `alias`
   * lives in that resolver. A plugin that answers `external: true` for
   * `@warlock.js/core` therefore beats the alias pointing it at core's
   * source — the framework silently stops being bundled at all, the build
   * still succeeds, and the artifact is a 2.8 KB entry file importing a
   * package the app cannot resolve. Returning `undefined` for these hands
   * them back to the resolver, alias intact.
   *
   * Matched as esbuild matches them: the exact key, or the key followed by a
   * subpath.
   */
  aliasKeys: readonly string[];
}): Plugin {
  const appRoot = path.resolve(options.appRoot);
  const aliasKeys = [...options.aliasKeys];

  function isAliased(specifier: string): boolean {
    return aliasKeys.some((key) => specifier === key || specifier.startsWith(`${key}/`));
  }

  // Keyed by the importer's DIRECTORY: the walk and the manifest read are
  // identical for every file in it, and a bundle of this size resolves
  // thousands of edges out of a few hundred directories.
  const dependenciesByDir = new Map<string, ReadonlySet<string> | undefined>();

  function declaredDependenciesOf(importer: string): ReadonlySet<string> | undefined {
    const dir = path.dirname(importer);
    if (dependenciesByDir.has(dir)) return dependenciesByDir.get(dir);

    const result = findOwningDependencies(importer);
    dependenciesByDir.set(dir, result);

    return result;
  }

  return {
    name: "warlock:bundle-framework-dependencies",
    setup(build) {
      // Everything is inspected and the bare-specifier test is made in code:
      // a `filter` cheap enough to be worth writing cannot tell `C:\…` (an
      // absolute Windows path, and what the tsconfig aliases resolve to) from
      // a package called `c`. Externalising one of those would be silent and
      // fatal.
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace !== "file" && args.namespace !== "") return undefined;

        const specifier = args.path;

        if (!isBareSpecifier(specifier)) return undefined;

        if (isAliased(specifier)) return undefined;

        // A builtin is never external in the sense that matters — esbuild
        // already leaves `node:fs` alone and Node always has it.
        if (specifier.startsWith("node:") || isBuiltin(specifier)) return undefined;

        const importer = args.importer;

        // Nothing on disk to ask. An entry point has no importer at all, and
        // a virtual or generated importer has no package around it — either
        // way there is no manifest that could declare this, so it keeps the
        // behaviour it had before this plugin existed.
        if (!importer || !path.isAbsolute(importer)) {
          return { path: specifier, external: true };
        }

        if (isAppOwnedFile(importer, appRoot)) {
          return { path: specifier, external: true };
        }

        const declared = declaredDependenciesOf(importer);

        if (!declared?.has(packageNameOfSpecifier(specifier))) {
          return { path: specifier, external: true };
        }

        // Declared by the package that imports it: let esbuild's own
        // resolver take it, from this importer, and bundle the result.
        return undefined;
      });
    },
  };
}
