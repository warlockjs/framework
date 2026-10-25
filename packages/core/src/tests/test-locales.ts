import glob from "fast-glob";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { moduleOfLocaleJson } from "../localization/module-locale-paths";
import { registerLocaleDictionary } from "../localization/register-locale-dictionary";

/** Register data-only module dictionaries in the calling worker, without app side effects. */
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
