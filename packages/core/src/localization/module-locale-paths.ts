/**
 * Where an app module keeps its translation dictionaries.
 *
 * - `src/app/<module>/utils/locales.json` — the module's dictionary;
 * - `src/app/<module>/utils/locales/<feature>.json` — optional per-feature
 *   dictionaries, so parallel work on two features edits two files instead of
 *   one shared JSON file.
 *
 * Every dictionary of a module is registered under the module's name unless
 * the file names its own `$group`, and all of them are merged into the one
 * translation registry at load time (development, production and test
 * workers), so a key lives in exactly one file. Two files owning the same key
 * is an error that names both.
 */

/** Globs of the module dictionaries, relative to `src/`. */
export const MODULE_LOCALE_JSON_GLOBS = [
  "app/*/utils/locales.json",
  "app/*/utils/locales/*.json",
] as const;

const MODULE_LOCALE_JSON = /^(?:src\/)?app\/([^/]+)\/utils\/(?:locales|locales\/[^/]+)\.json$/;

function normalize(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Whether `path` (relative to the project, or to `src/`) is a module dictionary. */
export function isModuleLocaleJsonPath(path: string): boolean {
  return MODULE_LOCALE_JSON.test(normalize(path));
}

/** The module a dictionary belongs to, which is also its default group. */
export function moduleOfLocaleJson(path: string): string | undefined {
  return MODULE_LOCALE_JSON.exec(normalize(path))?.[1];
}

/** The feature of a `locales/<feature>.json` dictionary; `undefined` for `locales.json`. */
export function featureOfLocaleJson(path: string): string | undefined {
  return /\/utils\/locales\/([^/]+)\.json$/.exec(normalize(path))?.[1];
}
