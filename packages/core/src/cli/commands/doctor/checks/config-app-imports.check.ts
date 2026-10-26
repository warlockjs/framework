import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseImports } from "../../../../dev-server/parse-imports";
import { tsconfigManager } from "../../../../dev-server/tsconfig-manager";
import { Path } from "../../../../utils/normalized-path";
import { srcPath } from "../../../../utils/paths";
import type { DoctorCheck } from "../check.types";

const CONFIG_FILE = /\.(?:[cm]?[jt]sx?)$/;

/** One config import that reaches application code. */
export type ConfigAppImport = {
  /** Project-relative config file. */
  file: string;
  /** The import specifier as written. */
  specifier: string;
};

/**
 * Every runtime import (static or dynamic) in `src/config/*` that resolves into
 * `src/app/**`. Type-only imports are erased at build time and are not reported.
 */
export async function findConfigAppImports(): Promise<ConfigAppImport[]> {
  const configDirectory = srcPath("config");
  let names: string[];

  try {
    names = (await readdir(configDirectory, { withFileTypes: true }))
      .filter(
        (entry) => entry.isFile() && CONFIG_FILE.test(entry.name) && !entry.name.endsWith(".d.ts"),
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }

  tsconfigManager.init();

  const appRoot = Path.toRelative(srcPath("app")) + "/";
  const found: ConfigAppImport[] = [];

  for (const name of names) {
    const absolute = path.join(configDirectory, name);
    const imports = await parseImports(await readFile(absolute, "utf8"), absolute);

    for (const [specifier, { absolutePath, isTypeOnly }] of imports) {
      if (isTypeOnly) continue;
      if (!Path.toRelative(absolutePath).startsWith(appRoot)) continue;

      found.push({ file: Path.toRelative(absolute), specifier });
    }
  }

  return found;
}

/**
 * Config files run before the application is booted, in every process that
 * reads config (each test worker included). A config that imports application
 * code loads that code's whole module graph at that point, and a lazy
 * `import()` inside a hook still puts the target in the config's dependency
 * graph. Hooks belong in a module's `main.ts`, registered at runtime.
 */
export const configAppImportsCheck: DoctorCheck = {
  name: "config-app-imports",
  run: async () => {
    const imports = await findConfigAppImports();

    if (imports.length === 0) return undefined;

    const shown = imports
      .slice(0, 5)
      .map(({ file, specifier }) => `${file} imports "${specifier}"`)
      .join("; ");
    const more = imports.length > 5 ? `; and ${imports.length - 5} more` : "";

    return {
      name: "config-app-imports",
      status: "warn",
      detail:
        `${shown}${more}. Config files load before the app boots, so importing src/app code ` +
        "(even lazily) slows startup and every test worker. Register the hook at runtime " +
        "instead, e.g. onPageError() from a module's main.ts.",
    };
  },
};
