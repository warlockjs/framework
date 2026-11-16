/**
 * Turns facts and annotations into the content of every book file: the
 * per-file entries, the module summaries, `app/routes.json` and the page and
 * screen lists. Pure: no IO, so a spec can build inputs by hand.
 */
import { isBuiltin } from "node:module";
import path from "node:path";
import type { BookFacts, BookFile, BookRoute } from "../contracts/adapter";
import {
  BOOK_SCHEMA_VERSION,
  type BookAnnotations,
  type BookEntry,
  type BookMobileScreensFile,
  type BookModuleSummary,
  type BookRouteRef,
  type BookRoutesFile,
  type BookSitePagesFile,
} from "../contracts/book";
import { packageNameOf } from "../graph";
import {
  bookEntryPaths,
  GRIMOIRE_PATHS,
  isInsideFolder,
  mobileScreensPath,
  moduleSummaryPath,
  sitePagesPath,
} from "../paths";
import { isInsideBook, toJson } from "./io";

/** Key of `BookRoutesFile.modules` for routes with no routes file. */
export const NO_MODULE = "(none)";

const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Book entry path of every code file in the facts. A file whose mirror would
 * leave `grimoire/book/` (a path with `..`) has no entry.
 */
export function entryPathsFor(facts: Pick<BookFacts, "files" | "mobile">): Map<string, string> {
  const mobileRoots = new Map(facts.mobile.map((app) => [app.id, app.root]));
  const paths = bookEntryPaths(
    facts.files.map((file) => {
      const mobileRoot = file.mobileApp === null ? undefined : mobileRoots.get(file.mobileApp);

      return {
        file: file.file,
        mobileApp:
          file.mobileApp === null || mobileRoot === undefined
            ? null
            : { id: file.mobileApp, root: mobileRoot },
      };
    }),
  );

  for (const [file, entry] of paths) {
    if (!isInsideBook(entry)) paths.delete(file);
  }

  return paths;
}

function routeRef(route: BookRoute): BookRouteRef {
  return { method: route.method, path: route.path, name: route.name };
}

/** External package names a file imports: sorted, unique, Node builtins left out. */
function packagesOf(file: BookFile): string[] {
  const names = new Set<string>();

  for (const entry of file.imports) {
    if (entry.file !== null) continue;

    const name = packageNameOf(entry.specifier);

    if (name !== null && !isBuiltin(name)) names.add(name);
  }

  return [...names].sort(byText);
}

/** Lists indexed by a key, built once so lookups per file stay constant time. */
function groupBy<T>(items: Iterable<readonly [string | null, T]>): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const [key, item] of items) {
    if (key === null) continue;

    const group = groups.get(key);

    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  return groups;
}

type PageUse = {
  readonly site: string;
  readonly route: string;
  readonly via: "page" | "setup" | "layout";
};
type ScreenUse = {
  readonly app: string;
  readonly route: string;
  readonly via: "screen" | "layout";
};

const NO_ANNOTATION = { feature: null, borrowedBy: [], flows: [] } as const;

/** The entry of every code file, by source file. */
export function buildEntries(
  facts: BookFacts,
  annotations: BookAnnotations,
): Map<string, BookEntry> {
  const routes = facts.routes ?? [];
  const registered = groupBy(routes.map((route) => [route.sourceFile, route] as const));
  const handled = groupBy(routes.map((route) => [route.handlerFile, route] as const));
  const pages = groupBy<PageUse>(
    facts.pages.flatMap((page): (readonly [string | null, PageUse])[] => [
      [page.file, { site: page.site, route: page.route, via: "page" as const }] as const,
      [page.setupFile, { site: page.site, route: page.route, via: "setup" as const }] as const,
      ...page.layouts.map(
        (layout) =>
          [layout, { site: page.site, route: page.route, via: "layout" as const }] as const,
      ),
    ]),
  );
  const screens = groupBy<ScreenUse>(
    facts.mobile.flatMap((app) =>
      app.screens.flatMap((screen): (readonly [string | null, ScreenUse])[] => [
        [screen.file, { app: app.id, route: screen.route, via: "screen" as const }] as const,
        ...screen.layouts.map(
          (layout) =>
            [layout, { app: app.id, route: screen.route, via: "layout" as const }] as const,
        ),
      ]),
    ),
  );
  const entries = new Map<string, BookEntry>();

  for (const file of facts.files) {
    const annotation = annotations.files[file.file] ?? NO_ANNOTATION;
    const fileRoutes: BookEntry["routes"] = [
      ...(registered.get(file.file) ?? []).map((route) => ({
        ...routeRef(route),
        via: "registers" as const,
      })),
      ...(handled.get(file.file) ?? []).map((route) => ({
        ...routeRef(route),
        via: "handles" as const,
      })),
    ];

    entries.set(file.file, {
      schemaVersion: BOOK_SCHEMA_VERSION,
      file: file.file,
      module: file.module,
      type: file.type,
      lines: file.lines,
      about: file.about,
      feature: annotation.feature,
      borrowedBy: [...new Set(annotation.borrowedBy)].sort(byText),
      flows: [...new Set(annotation.flows)].sort(byText),
      exports: file.exports.map((entry) => ({ name: entry.name, about: entry.about })),
      packages: packagesOf(file),
      imports: [
        ...new Set(file.imports.flatMap((entry) => (entry.file === null ? [] : [entry.file]))),
      ].sort(byText),
      importedBy: [...new Set(file.importedBy)].sort(byText),
      routes: fileRoutes,
      pages: (pages.get(file.file) ?? []).sort(
        (left, right) =>
          byText(left.site, right.site) ||
          byText(left.route, right.route) ||
          byText(left.via, right.via),
      ),
      screens: (screens.get(file.file) ?? []).sort(
        (left, right) =>
          byText(left.app, right.app) ||
          byText(left.route, right.route) ||
          byText(left.via, right.via),
      ),
    });
  }

  return entries;
}

/** `app/routes.json`: routes grouped by the module of their routes file, in registration order. */
export function buildRoutesFile(facts: BookFacts): BookRoutesFile | null {
  if (facts.routes === null) return null;

  const moduleOf = new Map(facts.files.map((file) => [file.file, file.module]));
  const grouped = groupBy(
    facts.routes.map(
      (route) =>
        [
          route.sourceFile === null ? NO_MODULE : (moduleOf.get(route.sourceFile) ?? NO_MODULE),
          { ...routeRef(route), handlerFile: route.handlerFile },
        ] as const,
    ),
  );

  return {
    schemaVersion: BOOK_SCHEMA_VERSION,
    modules: Object.fromEntries([...grouped].sort(([left], [right]) => byText(left, right))),
  };
}

/** One `BookModuleSummary` per `module` value of the code files, sorted by module. */
export function buildModuleSummaries(
  facts: BookFacts,
  annotations: BookAnnotations,
): BookModuleSummary[] {
  const moduleOf = new Map(facts.files.map((file) => [file.file, file.module]));
  const byModule = groupBy(facts.files.map((file) => [file.module, file] as const));
  const routesByModule = groupBy(
    (facts.routes ?? []).map((route) => {
      const home = route.sourceFile ?? route.handlerFile;

      return [home === null ? null : (moduleOf.get(home) ?? null), routeRef(route)] as const;
    }),
  );
  const summaries: BookModuleSummary[] = [];

  for (const [module, files] of [...byModule].sort(([left], [right]) => byText(left, right))) {
    const featureCounts = new Map<string, number>();
    const importers = new Map<string, Set<string>>();

    for (const file of files) {
      const feature = annotations.files[file.file]?.feature ?? null;

      if (feature !== null) featureCounts.set(feature, (featureCounts.get(feature) ?? 0) + 1);

      for (const importer of file.importedBy) {
        const importerModule = moduleOf.get(importer);

        if (importerModule === undefined || importerModule === module) continue;

        const set = importers.get(importerModule) ?? new Set<string>();
        set.add(importer);
        importers.set(importerModule, set);
      }
    }

    summaries.push({
      module,
      features: [...featureCounts]
        .sort(([leftName, left], [rightName, right]) => right - left || byText(leftName, rightName))
        .map(([feature]) => feature),
      files: files
        .map((file) => ({ file: file.file, type: file.type, lines: file.lines, about: file.about }))
        .sort((left, right) => byText(left.file, right.file)),
      routes: routesByModule.get(module) ?? [],
      usedBy: [...importers]
        .map(([importer, set]) => ({ module: importer, files: set.size }))
        .sort((left, right) => right.files - left.files || byText(left.module, right.module)),
    });
  }

  return summaries;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The Markdown of one module summary (format in `BookModuleSummary`). */
export function renderModuleSummary(summary: BookModuleSummary): string {
  const lines = summary.files.reduce((total, file) => total + file.lines, 0);
  const counts = `${plural(summary.files.length, "file")}, ${plural(lines, "line")}.`;
  const features =
    summary.features.length === 0
      ? ""
      : `${summary.features.length === 1 ? "Feature" : "Features"}: ${summary.features.join(", ")}. `;
  const out = [`# ${summary.module}`, "", `${features}${counts}`];

  if (summary.files.length > 0) {
    out.push("", "## Files");

    for (const file of summary.files) {
      const relative = isInsideFolder(file.file, summary.module)
        ? path.posix.relative(summary.module, file.file)
        : file.file;

      out.push(
        `- ${[relative, file.type, ...(file.about === null ? [] : [file.about])].join("  ")}`,
      );
    }
  }

  if (summary.routes.length > 0) {
    out.push("", "## Routes");

    for (const route of summary.routes) out.push(`- ${route.method} ${route.path}`);
  }

  if (summary.usedBy.length > 0) {
    out.push("", "## Used by");

    for (const user of summary.usedBy) out.push(`- ${user.module} (${plural(user.files, "file")})`);
  }

  return `${out.join("\n")}\n`;
}

/**
 * The content of every book file Warlock writes from the facts and the
 * annotations, by project-relative path. `manifest.json`, `.cache/` and
 * `test-results.json` are not part of it.
 */
export function renderBook(facts: BookFacts, annotations: BookAnnotations): Map<string, string> {
  const contents = new Map<string, string>();
  const entries = buildEntries(facts, annotations);

  for (const [file, entryPath] of entryPathsFor(facts)) {
    const entry = entries.get(file);

    if (entry !== undefined) contents.set(entryPath, toJson(entry));
  }

  for (const summary of buildModuleSummaries(facts, annotations)) {
    const summaryPath = moduleSummaryPath(summary.module);

    if (isInsideBook(summaryPath)) contents.set(summaryPath, renderModuleSummary(summary));
  }

  const routesFile = buildRoutesFile(facts);

  if (routesFile !== null) contents.set(GRIMOIRE_PATHS.bookRoutes, toJson(routesFile));

  for (const site of facts.sites) {
    const sitePath = sitePagesPath(site.id);
    const file: BookSitePagesFile = {
      schemaVersion: BOOK_SCHEMA_VERSION,
      site,
      pages: facts.pages.filter((page) => page.site === site.id),
    };

    if (isInsideBook(sitePath)) contents.set(sitePath, toJson(file));
  }

  for (const app of facts.mobile) {
    const screensPath = mobileScreensPath(app.id);
    const { screens, ...rest } = app;
    const file: BookMobileScreensFile = { schemaVersion: BOOK_SCHEMA_VERSION, app: rest, screens };

    if (isInsideBook(screensPath)) contents.set(screensPath, toJson(file));
  }

  return contents;
}
