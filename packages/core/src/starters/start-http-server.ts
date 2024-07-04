import { typecheckPlugin } from "@jgoz/esbuild-plugin-typecheck";
import esbuild from "esbuild";
import path from "path";
import { buildHttpApp } from "../builder/build-http-app";
import { command } from "../console/command-builder";
import { srcPath, warlockPath } from "../utils";
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
    format: "cjs",
    target: ["esnext"],
    outdir: path.resolve(warlockPath()),
    plugins: [
      typecheckPlugin({
        watch: true,
      }),
      injectImportPathPlugin(),
      nativeNodeModulesPlugin,
      startServerPlugin,
    ],
  });

  builder.watch();
}

export function registerHttpDevelopmentServerCommand() {
  return command("dev").action(startHttpApp).preload("watch");
}
