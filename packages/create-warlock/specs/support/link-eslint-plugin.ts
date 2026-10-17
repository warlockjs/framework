import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The plugin's source in this repository (`packages/eslint-plugin`). */
const eslintPluginSource = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../eslint-plugin",
);

/**
 * Make `@warlock.js/eslint-plugin` resolvable from a scaffolded test app.
 *
 * The template's flat config imports the plugin, but create-warlock installs
 * standalone (its own lockfile), so the plugin is never in its dependency
 * tree, and an unreleased version is not on the registry either. Linking the
 * repository's source into the app's `node_modules` gives every run, inside the
 * workspace or standalone, the same plugin; the spawned ESLint loads it with
 * `--import tsx`. The plugin has no runtime dependencies of its own.
 */
export function linkEslintPlugin(appPath: string): void {
  const scope = path.join(appPath, "node_modules", "@warlock.js");
  const link = path.join(scope, "eslint-plugin");

  if (existsSync(link)) {
    return;
  }

  mkdirSync(scope, { recursive: true });
  symlinkSync(eslintPluginSource, link, process.platform === "win32" ? "junction" : "dir");
}
