import { typecheckPlugin } from "@jgoz/esbuild-plugin-typecheck";
import { debounce } from "@mongez/reinforcements";
import chokidar from "chokidar";
import esbuild from "esbuild";
import path from "path";
import { buildHttpApp } from "../builder/build-http-app";
import { command } from "../console/command-builder";
import { rootPath, srcPath, warlockPath } from "../utils";
import {
  injectImportPathPlugin,
  nativeNodeModulesPlugin,
  startServerPlugin,
} from "./../esbuild";

export async function startHttpApp() {
  const httpPath = await buildHttpApp();

  const builder = await esbuild.context({
    platform: "node",
    entryPoints: [httpPath],
    bundle: true,
    minify: false,
    packages: "external",
    sourcemap: "linked",
    sourceRoot: srcPath(),
    format: "esm",
    target: ["esnext"],
    outdir: path.resolve(warlockPath()),
    // Enable code splitting
    splitting: true,
    // Output chunks to a separate directory with meaningful names
    chunkNames: "chunks/[name]",
    // Ensure each entry point generates its own chunk
    outbase: warlockPath(),
    // Tree shaking for smaller bundles
    treeShaking: true,
    // Generate metafile for analysis
    metafile: true,
    // Deduplicate modules
    mainFields: ["module", "main"],
    conditions: ["import", "module"],
    // Preserve imports structure
    preserveSymlinks: true,
    plugins: [
      typecheckPlugin({
        watch: true,
      }),
      injectImportPathPlugin(),
      nativeNodeModulesPlugin,
      startServerPlugin,
    ],
  });

  // Set up chokidar to watch additional files (e.g., .env)
  const watcher = chokidar.watch(
    [
      rootPath(".env"),
      rootPath(".env.shared"),
      srcPath(),
      // Add other files or patterns as needed
    ],
    {
      persistent: true,
      ignoreInitial: false,
      ignored: ["node_modules/**", "dist/**"], // Ignore irrelevant paths
    },
  );

  const rebuild = debounce(() => {
    builder.rebuild();
  }, 500);

  watcher.on("add", rebuild);
  watcher.on("change", rebuild);
  watcher.on("unlink", rebuild);
  watcher.on("unlinkDir", rebuild);
}

export function registerHttpDevelopmentServerCommand() {
  return command("dev").action(startHttpApp).preload("watch");
}
