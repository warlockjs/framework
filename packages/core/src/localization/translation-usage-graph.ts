import fs from "node:fs";
import path from "node:path";
import {
  EMPTY_TRANSLATION_USAGE,
  mergeTranslationUsage,
  readTranslationDeclarations,
  scanTranslationSource,
  translationDeclarationUsage,
  usageOf,
  type TranslationUsage,
} from "./translation-usage";

/** Source files the walk reads. */
const CODE_FILE = /\.[cm]?[jt]sx?$/;

/** Extensions tried, in order, for an extension-less specifier. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

export type TranslationGraphInput = {
  /** The client entry files a render can execute: the page, its layouts, the root and error pages. */
  readonly entries: readonly string[];
  /** Setup files whose `config.translations` declare keys static analysis cannot see. */
  readonly setupFiles?: readonly string[];
  /** Source text of a file, or `undefined` when it cannot be read. */
  readonly readSource: (file: string) => string | undefined;
  /** Resolves a specifier imported by `importer` to a project file, or `undefined` for a package. */
  readonly resolveImport: (specifier: string, importer: string) => string | undefined;
};

export type TranslationGraphResult = {
  /** The union of every reachable file's usage and the declared keys. */
  readonly usage: TranslationUsage;
  /** Every project file the walk read, so a caller can tell when the answer may have changed. */
  readonly files: readonly string[];
};

/**
 * Walk the client module graph from `entries` and union what every reachable
 * file can look up.
 *
 * The walk follows value imports, re-exports and dynamic `import()` into
 * project files only. A package is not followed: packages do not carry
 * application translation keys. Fail closed: a reachable file that cannot be
 * read or parsed makes the whole graph dynamic, so the caller ships everything
 * rather than a set that might be missing a key.
 */
export function analyzeTranslationGraph(input: TranslationGraphInput): TranslationGraphResult {
  const seen = new Set<string>();
  const files: string[] = [];
  const usages: TranslationUsage[] = [];
  const queue = [...input.entries];

  for (const setupFile of input.setupFiles ?? []) {
    files.push(setupFile);
    usages.push(readDeclarations(input, setupFile));
  }

  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);

    const text = input.readSource(file);

    if (text === undefined) {
      usages.push(unreadable(file, "the file could not be read"));
      continue;
    }

    try {
      const scan = scanTranslationSource(file, text);
      usages.push(scan.usage);

      for (const specifier of scan.imports) {
        const resolved = input.resolveImport(specifier, file);
        if (resolved !== undefined && !seen.has(resolved)) queue.push(resolved);
      }
    } catch (error) {
      usages.push(
        unreadable(
          file,
          `the file could not be parsed (${error instanceof Error ? error.message : String(error)})`,
        ),
      );
    }
  }

  return { usage: mergeTranslationUsage(usages), files };
}

function readDeclarations(input: TranslationGraphInput, setupFile: string): TranslationUsage {
  const text = input.readSource(setupFile);
  if (text === undefined) return unreadable(setupFile, "the setup file could not be read");

  const entries = readTranslationDeclarations(setupFile, text);
  if (entries === undefined) return EMPTY_TRANSLATION_USAGE;

  return mergeTranslationUsage(
    entries.map((entry) => translationDeclarationUsage(entry, setupFile)),
  );
}

/** A dynamic usage that names the file which forced it. */
function unreadable(file: string, reason: string): TranslationUsage {
  return usageOf({
    dynamic: true,
    dynamicSites: [{ file, line: 1, column: 1, text: `<${reason}>` }],
  });
}

/**
 * Resolve a specifier for the translation graph: relative paths, and the
 * `web/` and `app/` conventions under the source root. Anything else is a
 * package and resolves to `undefined`.
 */
export function resolveSourceImport(
  specifier: string,
  importer: string,
  appSrcRoot: string,
): string | undefined {
  let base: string;

  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(importer), specifier);
  } else if (specifier.startsWith("web/") || specifier.startsWith("app/")) {
    base = path.join(appSrcRoot, specifier);
  } else {
    return undefined;
  }

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];

  // TypeScript sources imported with their emitted `.js` extension.
  if (/\.jsx?$/.test(base)) {
    const stripped = base.replace(/\.jsx?$/, "");
    candidates.push(...SOURCE_EXTENSIONS.map((extension) => `${stripped}${extension}`));
  }

  // Only code is walked: a JSON, CSS or asset import carries no translation lookup.
  return candidates.find((candidate) => CODE_FILE.test(candidate) && isFile(candidate));
}

function isFile(candidate: string): boolean {
  return fs.statSync(candidate, { throwIfNoEntry: false })?.isFile() === true;
}

/** Read a file as UTF-8, or `undefined` when it is missing or unreadable. */
export function readSourceFile(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Analyze a page's client graph against the filesystem: the convenience the
 * build and the development server both use. `appSrcRoot` is the application's
 * `src` directory, which the `web/` and `app/` specifiers resolve against.
 */
export function analyzePageTranslationUsage(input: {
  readonly appSrcRoot: string;
  readonly entries: readonly string[];
  readonly setupFiles?: readonly string[];
}): TranslationGraphResult {
  return analyzeTranslationGraph({
    entries: input.entries,
    setupFiles: input.setupFiles,
    readSource: readSourceFile,
    resolveImport: (specifier, importer) =>
      resolveSourceImport(specifier, importer, input.appSrcRoot),
  });
}
