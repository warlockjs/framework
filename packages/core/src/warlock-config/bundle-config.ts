import type { TsconfigRaw } from "esbuild";
import { getTsconfig } from "get-tsconfig";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Local source files the config bundle inlines. Everything else a config can
 * import (JSON, assets) is left to esbuild's own loaders.
 */
const LOCAL_SOURCE_FILTER = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Marks the nested `build.resolve()` the alias check makes, so the plugin's
 * own resolver does not intercept it again.
 */
const ALIAS_PROBE = Symbol("warlock-config-alias-probe");

/**
 * Bundle `warlock.config.ts` and its LOCAL import graph into one ESM module.
 *
 * Used when the runtime cannot import the config as written: Node without
 * native TypeScript, or native TypeScript meeting what only a TS toolchain
 * resolves (an extensionless `./src/connectors/local` import, a tsconfig
 * `paths` alias such as `app/*`).
 *
 * - Relative, absolute and tsconfig-`paths` imports are inlined, so the whole
 *   local graph is transpiled and resolved the way TypeScript sees it.
 * - Every other bare specifier (`@warlock.js/*`, npm packages, `node:*`) stays
 *   an import, so the config shares the application's module instances:
 *   `BaseConnector`, the container and every registry keep one identity.
 * - `import.meta.url` / `dirname` / `filename` in each inlined module are
 *   replaced with that module's ORIGINAL location, so assets resolved relative
 *   to a connector's own folder keep working after inlining. Only real
 *   `import.meta` expressions are replaced: text in strings and comments is
 *   left alone. `import.meta.resolve()` is not rewritten; resolve from
 *   `import.meta.url` instead (`new URL("./asset", import.meta.url)`).
 * - `@warlock.js/*` is external even when a tsconfig `paths` pattern maps it to
 *   local source.
 * - A specifier that matches a tsconfig `paths` pattern is inlined only when it
 *   resolves to a file outside `node_modules`; a catch-all pattern such as
 *   `"*": ["./types/*"]` never pulls a package in.
 *
 * Returns the bundled source. The caller writes it beside the config (so the
 * external imports resolve from the project's `node_modules`) and imports it.
 */
export async function bundleWarlockConfig(configPath: string): Promise<string> {
  const { build } = await import("esbuild");
  const projectRoot = path.dirname(configPath);
  const tsconfig = getTsconfig(projectRoot);

  const isPathAlias = createPathAliasMatcher(tsconfig?.config.compilerOptions?.paths);

  const result = await build({
    entryPoints: [configPath],
    absWorkingDir: projectRoot,
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: `node${process.versions.node.split(".")[0]}`,
    tsconfig: tsconfig?.path,
    logLevel: "silent",
    plugins: [
      {
        name: "warlock-config-local-graph",
        setup(pluginBuild) {
          // Keep packages external, but let tsconfig `paths` aliases through to
          // esbuild's resolver: `app/connectors/local` is local code, not a package.
          pluginBuild.onResolve({ filter: /^[^./]/ }, async (args) => {
            if (args.kind === "entry-point" || path.isAbsolute(args.path)) return undefined;

            if (args.pluginData?.[ALIAS_PROBE]) return undefined;

            // The framework is never inlined, even where a monorepo's tsconfig
            // `paths` points `@warlock.js/*` at local source: a second copy of
            // core (its container, its connectors) would not be the application's.
            if (args.path.startsWith("@warlock.js/")) return { path: args.path, external: true };

            if (!isPathAlias(args.path)) return { path: args.path, external: true };

            // A `paths` pattern can match package names too (a catch-all `"*"`
            // does). Resolve it the way TypeScript would and inline it only
            // when it lands on the project's own source.
            const resolved = await pluginBuild.resolve(args.path, {
              kind: args.kind,
              resolveDir: args.resolveDir,
              importer: args.importer,
              pluginData: { [ALIAS_PROBE]: true },
            });

            if (resolved.errors.length > 0 || resolved.external || isInNodeModules(resolved.path)) {
              return { path: args.path, external: true };
            }

            return { path: resolved.path };
          });

          pluginBuild.onLoad({ filter: LOCAL_SOURCE_FILTER }, async (args) => {
            if (isInNodeModules(args.path)) return undefined;

            const source = await readFile(args.path, "utf8");
            const loader = loaderFor(args.path);

            if (!source.includes("import.meta")) {
              return { contents: source, loader, resolveDir: path.dirname(args.path) };
            }

            // `define` replaces only real `import.meta.*` expressions; text in
            // strings, templates and comments is untouched. JSX is preserved so
            // the bundle compiles it with the project's own JSX settings.
            const { transform } = await import("esbuild");
            const transformed = await transform(source, {
              loader,
              jsx: "preserve",
              sourcefile: args.path,
              tsconfigRaw: {
                compilerOptions: tsconfig?.config.compilerOptions as TsconfigRaw["compilerOptions"],
              },
              define: {
                "import.meta.url": JSON.stringify(pathToFileURL(args.path).href),
                "import.meta.dirname": JSON.stringify(path.dirname(args.path)),
                "import.meta.filename": JSON.stringify(args.path),
              },
            });

            return {
              contents: transformed.code,
              loader: loader === "tsx" || loader === "jsx" ? "jsx" : "js",
              resolveDir: path.dirname(args.path),
            };
          });
        },
      },
    ],
  });

  const output = result.outputFiles?.[0];

  if (!output) {
    throw new Error(`esbuild produced no output while bundling ${configPath}`);
  }

  return output.text;
}

/**
 * True when a bare specifier matches one of the tsconfig `paths` patterns.
 *
 * Only explicit `paths` count. `baseUrl` alone makes TypeScript (and
 * `get-tsconfig`'s `resolvePathAlias`) offer a candidate for EVERY bare
 * specifier, which would inline packages such as `@warlock.js/core` into the
 * bundle and split `BaseConnector` and the container into two identities.
 */
function createPathAliasMatcher(paths: Record<string, string[]> | undefined) {
  const patterns = Object.keys(paths ?? {});

  return (specifier: string) =>
    patterns.some((pattern) => {
      const star = pattern.indexOf("*");

      if (star === -1) return specifier === pattern;

      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);

      return (
        specifier.length >= prefix.length + suffix.length &&
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix)
      );
    });
}

/**
 * True when `filePath` lies inside a `node_modules` folder: a package, never
 * inlined into the config bundle.
 */
function isInNodeModules(filePath: string): boolean {
  return path.normalize(filePath).split(path.sep).includes("node_modules");
}

/**
 * The esbuild loader for a local source file, by extension.
 */
function loaderFor(filePath: string): "ts" | "tsx" | "js" | "jsx" {
  const extension = path.extname(filePath).replace(/^\.[cm]?/, "");

  if (extension === "tsx" || extension === "jsx" || extension === "ts") return extension;

  return "js";
}
