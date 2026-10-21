import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setConfig } from "../config/config-setter";
import type { AppModuleImporter } from "../loader/app-module-importer";
import { srcPath } from "../utils/paths";

/** Unit mode registers values only: no special handlers or connector side effects. */
export async function loadUnitConfig(importModule: AppModuleImporter): Promise<void> {
  const directory = srcPath("config");
  const files = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  });
  for (const file of files.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!file.isFile() || !/\.(?:ts|mjs|js)$/.test(file.name) || file.name.endsWith(".d.ts"))
      continue;
    const loaded = await importModule(pathToFileURL(path.join(directory, file.name)).href);
    if (typeof loaded === "object" && loaded !== null && "default" in loaded) {
      setConfig(file.name.replace(/\.(?:ts|mjs|js)$/, ""), loaded.default);
    }
  }
}
