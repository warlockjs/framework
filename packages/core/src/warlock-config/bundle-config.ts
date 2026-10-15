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
 * `import.meta.url`, `import.meta.dirname` and `import.meta.filename` in an
 * inlined local module.
 */
const IMPORT_META_PATTERN = /\bimport\.meta\.(url|dirname|filename)\b/g;

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
 *   rewritten to that module's ORIGINAL location, so assets resolved relative
 *   to a connector's own folder keep working after inlining.
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
          pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
            if (args.kind === "entry-point" || path.isAbsolute(args.path)) return undefined;

            if (isPathAlias(args.path)) return undefined;

            return { path: args.path, external: true };
          });

          pluginBuild.onLoad({ filter: LOCAL_SOURCE_FILTER }, async (args) => {
            if (args.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined;

            const source = await readFile(args.path, "utf8");
            const fileUrl = pathToFileURL(args.path).href;

            const contents = source.replace(IMPORT_META_PATTERN, (_match, property: string) => {
              if (property === "url") return JSON.stringify(fileUrl);
              if (property === "dirname") return JSON.stringify(path.dirname(args.path));

              return JSON.stringify(args.path);
            });

            return { contents, loader: loaderFor(args.path), resolveDir: path.dirname(args.path) };
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
 * The esbuild loader for a local source file, by extension.
 */
function loaderFor(filePath: string): "ts" | "tsx" | "js" | "jsx" {
  const extension = path.extname(filePath).replace(/^\.[cm]?/, "");

  if (extension === "tsx" || extension === "jsx" || extension === "ts") return extension;

  return "js";
}
