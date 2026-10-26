import { isBuiltin } from "node:module";
import path from "node:path";
import type { Plugin } from "esbuild";
import { isBareSpecifier, packageNameOfSpecifier } from "./bundle-framework-dependencies";
import {
  findPackageDirectory,
  isNativePackage,
  readManifest,
  type NativePackage,
} from "./native-addons";

/**
 * What a single-bundle build decided to leave out of the bundle.
 */
export type SingleBundleReport = {
  /** Packages with compiled binaries, left external and copied next to the bundle */
  native: Map<string, NativePackage>;
  /** Optional integrations the app does not install, left as lazy runtime imports */
  optional: Map<string, { importedBy: string }>;
};

export function createSingleBundleReport(): SingleBundleReport {
  return { native: new Map(), optional: new Map() };
}

/** Import kinds that run lazily or inside a guard, never at module evaluation. */
const LAZY_KINDS = new Set(["dynamic-import", "require-call"]);

function appDeclares(appManifest: ReturnType<typeof readManifest>, name: string): boolean {
  return [
    appManifest?.dependencies,
    appManifest?.optionalDependencies,
    appManifest?.peerDependencies,
    (appManifest as { devDependencies?: Record<string, string> } | undefined)?.devDependencies,
  ].some((group) => group !== undefined && name in group);
}

/**
 * Decide, per bare import in a `singleBundle` build, between three outcomes
 * that the plain `packages: "bundle"` setting gets wrong:
 *
 * 1. **A package with a native binary** stays external and is recorded so the
 *    builder can copy it (and what it loads) into `dist/node_modules`. Bundling
 *    it would turn the `.node` file into a path string and break the loader.
 * 2. **An optional integration the app does not install** stays external. The
 *    framework reaches S3, database drivers, jiti, mail transports and the
 *    like through `await import(...)` guarded by config; a package the app
 *    never declared is a branch that never runs, and failing the whole bundle
 *    over it forced every app to keep an `external` list by hand. The rule is
 *    narrow on purpose: the importer must belong to a package (not the app)
 *    that lists the specifier under `peerDependencies` or
 *    `optionalDependencies`, the app must not declare it anywhere, and the
 *    import must be lazy (`import()` or `require()`).
 * 3. **Everything else** is bundled — and if it cannot be resolved the build
 *    fails, so anything the app really imports is bundled or reported.
 */
export function singleBundleResolve(options: {
  appRoot: string;
  /** Keys of the esbuild `alias` map; handed back to esbuild untouched */
  aliasKeys: readonly string[];
  report: SingleBundleReport;
  /**
   * Packages that must be bundled even when they look optional. The builder
   * fills this from a first pass: a package left external at one import but
   * bundled at another (`ajv-formats` asks for `ajv` as an optional peer while
   * `@fastify/ajv-compiler` depends on it) has to be bundled at both, or the
   * first import fails at startup.
   */
  neverExternal?: ReadonlySet<string>;
}): Plugin {
  const appRoot = path.resolve(options.appRoot);
  const appManifest = readManifest(appRoot);
  const { report, aliasKeys } = options;

  const isAliased = (specifier: string) =>
    aliasKeys.some((key) => specifier === key || specifier.startsWith(`${key}/`));

  const isAppOwned = (file: string) => {
    const relative = path.relative(appRoot, file);

    return (
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      !relative.split(/[\\/]/).includes("node_modules")
    );
  };

  return {
    name: "warlock:single-bundle-resolve",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.warlockSingleBundle) return undefined;
        if (args.namespace !== "file" && args.namespace !== "") return undefined;

        const specifier = args.path;

        if (!isBareSpecifier(specifier) || isAliased(specifier)) return undefined;
        if (specifier.startsWith("node:") || isBuiltin(specifier)) return undefined;

        const name = packageNameOfSpecifier(specifier);
        const importer = args.importer;

        if (importer && path.isAbsolute(importer) && !isAppOwned(importer)) {
          const ownerDirectory = findPackageDirectory(importer);
          const owner = ownerDirectory ? readManifest(ownerDirectory) : undefined;
          const listedByOwner =
            owner?.peerDependencies?.[name] !== undefined ||
            owner?.optionalDependencies?.[name] !== undefined;

          if (
            listedByOwner &&
            !options.neverExternal?.has(name) &&
            LAZY_KINDS.has(args.kind) &&
            !appDeclares(appManifest, name)
          ) {
            if (!report.optional.has(name)) {
              report.optional.set(name, { importedBy: owner?.name ?? "a dependency" });
            }

            return { path: specifier, external: true };
          }
        }

        const resolved = await build.resolve(specifier, {
          importer,
          namespace: args.namespace,
          resolveDir: args.resolveDir,
          kind: args.kind,
          pluginData: { warlockSingleBundle: true },
        });

        if (resolved.errors.length > 0 || resolved.external || !resolved.path) return undefined;

        const directory = findPackageDirectory(resolved.path);

        if (directory && isNativePackage(directory)) {
          const nativeName = readManifest(directory)?.name ?? name;

          if (!report.native.has(nativeName)) {
            report.native.set(nativeName, { name: nativeName, directory });
          }

          return { path: specifier, external: true };
        }

        return undefined;
      });
    },
  };
}

/**
 * Package names that appear in a bundle's inputs, read from an esbuild
 * metafile: every `node_modules/<name>/` segment of an input path.
 */
export function bundledPackageNames(inputs: Record<string, unknown>): Set<string> {
  const names = new Set<string>();

  for (const file of Object.keys(inputs)) {
    const normalized = file.replace(/\\/g, "/");
    let index = normalized.lastIndexOf("node_modules/");

    while (index !== -1) {
      const rest = normalized.slice(index + "node_modules/".length);
      const segments = rest.split("/");
      const name = rest.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0]!;

      if (name) names.add(name);

      index = index === 0 ? -1 : normalized.lastIndexOf("node_modules/", index - 1);
    }
  }

  return names;
}

/**
 * Optional integrations the report left external that the bundle also contains.
 * Each is a package some import needs at startup, so the build runs again with
 * these bundled.
 */
export function externalizedButBundled(
  report: SingleBundleReport,
  inputs: Record<string, unknown>,
): string[] {
  const bundled = bundledPackageNames(inputs);

  return [...report.optional.keys()].filter((name) => bundled.has(name));
}
