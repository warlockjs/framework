import glob from "fast-glob";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { moduleOfLocaleJson } from "../localization/module-locale-paths";
import { registerLocaleDictionary } from "../localization/register-locale-dictionary";

/**
 * Register every module's `utils/locales.json` and `utils/locales/*.json` dictionaries in
 * the calling worker, without booting the app. Resolves to a function that removes them again.
 *
 * `setupTest()` calls it for you, in integration and in unit mode. Call it yourself from a
 * setup file that does not use `setupTest()`, such as an email preview harness or a custom
 * unit-project `setupFiles` entry.
 *
 * @example
 * import { loadTestLocales } from "@warlock.js/core/tests";
 *
 * const unload = await loadTestLocales();
 * // ...render translated text...
 * unload();
 */
export async function loadTestLocales(root = process.cwd()): Promise<() => void> {
  const cleanups: Array<() => void> = [];
  const cleanup = () => {
    for (const undo of [...cleanups.splice(0)].reverse()) undo();
  };
  try {
    const files = await glob(["src/app/*/utils/locales.json", "src/app/*/utils/locales/*.json"], {
      cwd: root,
    });
    for (const sourceFile of [...files].sort()) {
      const namespace = moduleOfLocaleJson(sourceFile);
      if (!namespace) continue;
      cleanups.push(
        registerLocaleDictionary({
          sourceFile,
          source: await readFile(resolve(root, sourceFile), "utf8"),
          defaultNamespace: namespace,
        }),
      );
    }
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
