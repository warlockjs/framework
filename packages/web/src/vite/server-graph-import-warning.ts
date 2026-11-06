/**
 * Development warning for an import the production build rejects.
 *
 * Pages are compiled into the server bundle, which takes plain code imports
 * only: static assets and `?raw` / `?url` / `?worker` queries fail the build.
 * Vite resolves all of them in development, so the failure used to show up
 * only at `warlock build`. This plugin reads each module the dev server
 * evaluates for SSR (the server graph) and names such an import the first time
 * it sees the file. A module only the browser loads is never read here.
 * The warning is advisory and never changes the module.
 */
import path from "node:path";
import type { Plugin } from "vite";
import { serverGraphImportHazards, SERVER_GRAPH_IMPORT_REMEDY } from "../build/server-graph-imports";
import { moduleKey } from "../shared/module-key";

const CODE_MODULE = /\.([cm]?[jt]sx?)$/;
const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;

/** The warning text for one module, or `undefined` when its imports are fine. */
export function serverGraphImportWarning(code: string, file: string): string | undefined {
  const [first] = serverGraphImportHazards(code);

  if (!first) return undefined;

  return [
    `[warlock:web] "${file}" ${first.reason} (${first.specifier}).`,
    ``,
    `Cause: pages are compiled into the production server bundle, which supports plain code imports only. This works in development, and \`warlock build\` fails on it.`,
    `Fix: ${SERVER_GRAPH_IMPORT_REMEDY}.`,
  ].join("\n");
}

/**
 * Dev-server plugin: warns once per module evaluated for SSR that imports a
 * static asset or a `?raw` / `?url` / `?worker` query. Serve-only.
 */
export function serverGraphImportWarningPlugin(appRoot: string): Plugin {
  const warned = new Set<string>();

  return {
    name: "warlock:server-graph-import-warning",
    apply: "serve",
    enforce: "pre",
    transform(code, id, options) {
      if (options?.ssr !== true) return null;
      const file = moduleKey(id);
      if (!CODE_MODULE.test(file) || TEST_FILE.test(file) || warned.has(file)) return null;
      if (file.includes("/node_modules/")) return null;

      warned.add(file);
      const message = serverGraphImportWarning(code, path.relative(appRoot, file).split(path.sep).join("/"));
      if (message) this.warn(message);

      return null;
    },
  };
}
