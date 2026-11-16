/**
 * Puts every path an adapter reports into one form (project-relative, `/`,
 * no leading `./`), so facts from a Windows machine and a POSIX machine give
 * the same book.
 */
import type {
  BookFacts,
  BookFile,
  BookMobileApp,
  BookNamedThing,
  BookPage,
  BookRoute,
  BookSite,
} from "../contracts/adapter";
import { toPosixPath } from "../paths";

/** A project-relative POSIX path. */
export function cleanPath(file: string): string {
  return toPosixPath(file)
    .replace(/^(?:\.\/)+/, "")
    .replace(/\/+$/, "");
}

function cleanNullable(file: string | null): string | null {
  return file === null ? null : cleanPath(file);
}

export function normalizeFiles(files: readonly BookFile[]): BookFile[] {
  return files.map((file) => ({
    ...file,
    file: cleanPath(file.file),
    module: cleanPath(file.module),
    imports: file.imports.map((entry) => ({ ...entry, file: cleanNullable(entry.file) })),
    importedBy: file.importedBy.map(cleanPath),
  }));
}

export function normalizeRoutes(routes: readonly BookRoute[]): BookRoute[] {
  return routes.map((route) => ({
    ...route,
    method: route.method.toUpperCase(),
    sourceFile: cleanNullable(route.sourceFile),
    handlerFile: cleanNullable(route.handlerFile),
  }));
}

export function normalizeSites(sites: readonly BookSite[]): BookSite[] {
  return sites.map((site) => ({ ...site, root: cleanPath(site.root) }));
}

export function normalizePages(pages: readonly BookPage[]): BookPage[] {
  return pages.map((page) => ({
    ...page,
    file: cleanPath(page.file),
    setupFile: cleanNullable(page.setupFile),
    layouts: page.layouts.map(cleanPath),
    loaders: page.loaders.map(cleanPath),
    reachedFrom:
      page.reachedFrom === null
        ? null
        : page.reachedFrom.map((link) => ({ ...link, from: cleanPath(link.from) })),
  }));
}

export function normalizeMobile(apps: readonly BookMobileApp[]): BookMobileApp[] {
  return apps.map((app) => ({
    ...app,
    root: cleanPath(app.root),
    routesDir: cleanNullable(app.routesDir),
    screens: app.screens.map((screen) => ({
      ...screen,
      file: cleanPath(screen.file),
      layouts: screen.layouts.map(cleanPath),
    })),
  }));
}

export function normalizeNamed(named: readonly BookNamedThing[]): BookNamedThing[] {
  return named.map((thing) => ({ ...thing, file: cleanNullable(thing.file) }));
}

/** The facts with every path in one form. */
export function normalizeFacts(facts: BookFacts): BookFacts {
  return {
    files: normalizeFiles(facts.files),
    routes: facts.routes === null ? null : normalizeRoutes(facts.routes),
    sites: normalizeSites(facts.sites),
    pages: normalizePages(facts.pages),
    mobile: normalizeMobile(facts.mobile),
    named: normalizeNamed(facts.named),
    tests: [...new Set(facts.tests.map(cleanPath))].sort(),
  };
}
