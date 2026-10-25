import fg from "fast-glob";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  LocaleDictionaryError,
  parseLocaleDictionary,
} from "../../localization/parse-locale-dictionary";
import {
  MODULE_LOCALE_JSON_GLOBS,
  moduleOfLocaleJson,
} from "../../localization/module-locale-paths";
import { createProblem, type ToolingProblem } from "../problem";

/** The longest list of missing locales one problem spells out. */
const MAX_LISTED = 3;

/**
 * The locales the app is configured for: `localeCodes` in `.warlock-check.json`
 * when set, otherwise the string array literal `localeCodes` in
 * `src/config/app.ts`. `undefined` when neither names any, in which case the
 * coverage rule has nothing to compare against and stays silent.
 */
export function configuredLocaleCodes(
  cwd: string,
  fromCheckConfig?: readonly string[],
): string[] | undefined {
  if (fromCheckConfig && fromCheckConfig.length > 0) return [...fromCheckConfig];

  for (const name of ["app.ts", "app.tsx"]) {
    const file = path.join(cwd, "src", "config", name);

    if (!existsSync(file)) continue;

    const list = /\blocaleCodes\s*:\s*\[([^\]]*)\]/.exec(readFileSync(file, "utf8"))?.[1];

    if (list === undefined) continue;

    const codes = [...list.matchAll(/["'`]([A-Za-z][A-Za-z0-9-]*)["'`]/g)].map(
      (match) => match[1]!,
    );

    if (codes.length > 0) return codes;
  }

  return undefined;
}

/** The module dictionaries of a project, project-relative and sorted. */
export function moduleLocaleFiles(cwd: string): string[] {
  return fg
    .sync(
      MODULE_LOCALE_JSON_GLOBS.map((glob) => `src/${glob}`),
      { cwd, onlyFiles: true },
    )
    .sort();
}

/**
 * `WL9105`: every translation key of every module dictionary
 * (`utils/locales.json` and `utils/locales/<feature>.json`) must carry every
 * configured locale. Runs without booting the app, so CI catches in the pull
 * request what boot would otherwise throw at start-up.
 *
 * A dictionary that cannot be parsed is reported with `WL1007` and the
 * parser's own message, which names the file and the key.
 */
export function localeCoverageProblems(
  cwd: string,
  localeCodes: readonly string[] | undefined,
): ToolingProblem[] {
  if (!localeCodes || localeCodes.length === 0) return [];

  const problems: ToolingProblem[] = [];

  for (const file of moduleLocaleFiles(cwd)) {
    let entries: Record<string, Record<string, string>>;

    try {
      entries = parseLocaleDictionary({
        sourceFile: file,
        source: readFileSync(path.join(cwd, file), "utf8"),
        defaultNamespace: moduleOfLocaleJson(file) ?? path.basename(path.dirname(file)),
      }).entries;
    } catch (error) {
      if (!(error instanceof LocaleDictionaryError)) throw error;

      problems.push(
        createProblem({ code: "WL1007", source: "convention", message: error.message, file }),
      );
      continue;
    }

    for (const [key, translations] of Object.entries(entries)) {
      const missing = localeCodes.filter((code) => !(code in translations));

      if (missing.length === 0) continue;

      const shown = missing.slice(0, MAX_LISTED).join(", ");
      const rest = missing.length > MAX_LISTED ? ` and ${missing.length - MAX_LISTED} more` : "";

      problems.push(
        createProblem({
          code: "WL9105",
          source: "convention",
          message: `Translation key "${key}" is missing the locale ${shown}${rest} (configured: ${localeCodes.join(", ")}).`,
          file,
        }),
      );
    }
  }

  return problems;
}
