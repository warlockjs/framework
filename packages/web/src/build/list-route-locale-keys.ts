import fs from "node:fs";
import path from "node:path";
import { discoverPageFileGraph } from "./discover-pages";
import { parseRouteLocaleFile } from "./parse-route-locales";
import { localeCodesForFile, type SiteLocaleCodes } from "./site-locale-codes";
import { assertRouteLocaleKeyOwnership } from "./route-locale-key-ownership";

export type ListRouteLocaleKeysOptions = {
  appRoot?: string;
  /** Source directory beneath appRoot, or an absolute source directory. */
  srcDir?: string;
  /** `app.localeCodes`; when given, files are parsed against it. */
  localeCodes?: readonly string[];
  /** Locales of the sites that declare their own, by site key. */
  siteLocaleCodes?: SiteLocaleCodes;
};

/**
 * Lists the complete JSON translation-key union without evaluating application
 * modules or configuration. Runtime locale coverage is checked by the installer.
 */
export function listRouteLocaleKeys(options: ListRouteLocaleKeysOptions = {}): string[] {
  const appRoot = options.appRoot ?? process.cwd();
  const graph = discoverPageFileGraph(path.resolve(appRoot, options.srcDir ?? "src"));
  const parsed = graph.localeFiles.map((file) =>
    parseRouteLocaleFile({
      ...file,
      source: fs.readFileSync(file.sourceFile, "utf-8"),
      localeCodes: localeCodesForFile(
        file.sourceFile,
        options.localeCodes,
        options.siteLocaleCodes,
      ),
    }),
  );
  return assertRouteLocaleKeyOwnership(parsed);
}
