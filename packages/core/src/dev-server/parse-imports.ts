import { fileExistsAsync, directoryExistsAsync } from "@warlock.js/fs";
import { ImportSpecifier, parse } from "es-module-lexer";
import path from "node:path";
import { Path } from "./path";
import { tsconfigManager } from "./tsconfig-manager";

/**
 * Detect if a file contains only type definitions (no runtime code)
 *
 * A file is considered type-only if ALL its exports are:
 * - interface declarations
 * - type alias declarations
 * - export type { ... } statements
 * - export type { ... } from "..." statements
 *
 * Files with any of these are NOT type-only:
 * - export const/let/var
 * - export function
 * - export class
 * - export default (non-type)
 * - export { ... } (without type keyword)
 * - export * from (without type keyword)
 *
 * @param source - The source code to analyze
 * @returns true if the file exports only types
 */
export function isTypeOnlyFile(source: string): boolean {
  // Remove comments to avoid false positives
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/.*$/gm, ""); // line comments

  // Remove string literals to avoid false positives
  const withoutStrings = withoutComments
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

  // Patterns for type-only exports (these are safe)
  const typeOnlyPatterns = [
    /export\s+type\s+\{[^}]*\}/g, // export type { Foo, Bar }
    /export\s+type\s+\{[^}]*\}\s+from\s+['"]/g, // export type { Foo } from "..."
    /export\s+interface\s+\w+/g, // export interface Foo
    /export\s+type\s+\w+\s*=/g, // export type Foo =
  ];

  // Remove all type-only exports from consideration
  let remaining = withoutStrings;
  for (const pattern of typeOnlyPatterns) {
    remaining = remaining.replace(pattern, "");
  }

  // Patterns for runtime exports (these make the file NOT type-only)
  const runtimeExportPatterns = [
    /export\s+(?:const|let|var)\s+\w+/g, // export const/let/var foo
    /export\s+function\s+\w+/g, // export function foo
    /export\s+async\s+function\s+\w+/g, // export async function foo
    /export\s+class\s+\w+/g, // export class Foo
    /export\s+enum\s+\w+/g, // export enum Foo (enums have runtime value)
    /export\s+default\s+(?!type\s)/g, // export default (not type)
    /export\s+\{[^}]*\}(?!\s+from)/g, // export { foo } (local re-export without type)
    /export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]/g, // export { foo } from (without type)
    /export\s+\*\s+from\s+['"][^'"]+['"]/g, // export * from (re-exports everything)
    /export\s+\*\s+as\s+\w+/g, // export * as namespace
  ];

  for (const pattern of runtimeExportPatterns) {
    if (pattern.test(remaining)) {
      // Reset regex lastIndex for subsequent tests
      pattern.lastIndex = 0;

      // Special case: check if export { } contains only type exports
      if (pattern.source.includes("export\\s+\\{")) {
        const matches = remaining.match(/export\s+\{([^}]*)\}(?:\s+from\s+['"][^'"]+['"])?/g);
        if (matches) {
          for (const match of matches) {
            // Skip if it's already a type export
            if (/^export\s+type\s+/.test(match)) continue;

            // Extract the specifiers
            const specifiersMatch = match.match(/export\s+\{([^}]*)\}/);
            if (specifiersMatch) {
              const specifiers = specifiersMatch[1];
              const items = specifiers
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);

              // If any specifier is NOT prefixed with "type ", this is a runtime export
              const hasRuntimeSpecifier = items.some((item) => !item.startsWith("type "));
              if (hasRuntimeSpecifier) {
                return false;
              }
            }
          }
        }
        continue;
      }

      return false;
    }
  }

  // If we get here, no runtime exports were found
  // But we should also verify the file has at least some type exports
  // (an empty file or file with only imports is not really "type-only")
  const hasTypeExports = typeOnlyPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(withoutStrings);
  });

  return hasTypeExports;
}

/**
 * Check if an import statement is a pure `import type` (the keyword sits
 * immediately after `import`, covering `import type { X }`, `import type Foo`,
 * and `import type * as Ns`).
 */
function isTypeOnlyImport(line: string): boolean {
  const trimmed = line.trim();

  return trimmed.startsWith("import type ") || !!trimmed.match(/^import\s+type\s+[\{\*]/);
}

/**
 * Decide whether an `import ... from "m"` statement contributes any runtime
 * binding. Returns false for pure `import type` and for destructured imports
 * where every specifier is prefixed with the `type` keyword.
 */
function hasRuntimeImports(line: string): boolean {
  const trimmed = line.trim();

  if (isTypeOnlyImport(trimmed)) {
    return false;
  }

  const specifiersMatch = trimmed.match(/import\s+(?:type\s+)?\{([^}]+)\}/);

  if (!specifiersMatch) {
    return true;
  }

  const items = specifiersMatch[1].split(",").map((s) => s.trim()).filter(Boolean);

  return !items.every((item) => /^type\s+\w+/.test(item));
}

/**
 * Decide whether an `export ... from "m"` statement re-exports only types.
 * Covers `export type { X } from`, `export type * from`, and
 * `export { type X, type Y } from`.
 */
function isExportTypeOnlyStatement(line: string): boolean {
  const trimmed = line.trim();

  if (/^export\s+type\s+/.test(trimmed)) {
    return true;
  }

  const specifiersMatch = trimmed.match(/export\s+\{([^}]+)\}/);

  if (!specifiersMatch) {
    return false;
  }

  const items = specifiersMatch[1].split(",").map((s) => s.trim()).filter(Boolean);

  return items.every((item) => /^type\s+\w+/.test(item));
}

/**
 * Extract import paths using regex (more reliable for TypeScript).
 * Each entry carries an `isTypeOnly` flag: true when every occurrence of the
 * path in the source is a type-only statement (no runtime binding).
 * A single runtime occurrence makes the path runtime.
 */
function extractImportPathsWithRegex(
  source: string,
): Array<{ path: string; originalLine: string; isTypeOnly: boolean }> {
  const imports: Array<{ path: string; originalLine: string; isTypeOnly: boolean }> = [];
  const seenPaths = new Map<string, number>();

  /**
   * Record an import path with its type-only flag.
   * If the same path appears in multiple statements, the edge is type-only
   * iff every occurrence is type-only â€” a single runtime statement makes it runtime.
   */
  const record = (importPath: string, originalLine: string, isTypeOnly: boolean): void => {
    if (!importPath) {
      return;
    }

    const existingIndex = seenPaths.get(importPath);

    if (existingIndex === undefined) {
      seenPaths.set(importPath, imports.length);
      imports.push({ path: importPath, originalLine, isTypeOnly });

      return;
    }

    if (!isTypeOnly) {
      imports[existingIndex].isTypeOnly = false;
    }
  };

  // Pattern 1: Standard ES module imports (handles multiline)
  // Matches: import { ... } from "path", import Foo from "path", import Foo, { ... } from "path"
  const importRegex =
    /import\s+(?:type\s+)?(\{[\s\S]*?\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{[\s\S]*?\})?)\s+from\s+['"]([^'"]+)['"]/g;

  let match;

  while ((match = importRegex.exec(source)) !== null) {
    const fullMatch = match[0];
    const importPath = match[2];
    const isTypeOnly = !hasRuntimeImports(fullMatch);

    record(importPath, fullMatch, isTypeOnly);
  }

  // Pattern 1b: Side-effect imports - import "path" â€” always runtime
  const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;

  while ((match = sideEffectRegex.exec(source)) !== null) {
    record(match[1], match[0], false);
  }

  // Pattern 2: Dynamic imports - import("path") â€” always runtime
  const dynamicImportPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  while ((match = dynamicImportPattern.exec(source)) !== null) {
    record(match[1], match[0], false);
  }

  // Pattern 3: Export from - export ... from "path"
  const exportFromPattern = /export\s+(?:\{[^}]*\}|\*|\w+)\s+from\s+['"]([^'"]+)['"]/g;

  while ((match = exportFromPattern.exec(source)) !== null) {
    const fullMatch = match[0];

    record(match[1], fullMatch, isExportTypeOnlyStatement(fullMatch));
  }

  return imports;
}

/**
 * Metadata for a single resolved import edge.
 * `isTypeOnly` is true iff every import/export statement that references this
 * path is type-only (pure `import type`, `export type`, or destructured lists
 * where every specifier carries the `type` keyword). A single runtime
 * occurrence flips the flag to false â€” that's what matters for cycle detection.
 */
export type ResolvedImport = {
  absolutePath: string;
  isTypeOnly: boolean;
};

/**
 * Parse import/export statements in a TS/JS source file and return the
 * resolved dependency edges keyed by the original import path. Includes
 * type-only edges (flagged) so downstream consumers can distinguish runtime
 * cycles from type-only ones.
 *
 * @example
 * const importMap = await parseImports(source, "/abs/path/to/file.ts");
 * for (const [importPath, { absolutePath, isTypeOnly }] of importMap) {
 *   // ...
 * }
 */
export async function parseImports(
  source: string,
  filePath: string,
): Promise<Map<string, ResolvedImport>> {
  try {
    // Skip .d.ts files - they're type declarations, not runtime code
    if (filePath.endsWith(".d.ts")) {
      return new Map();
    }

    // Try es-module-lexer first (faster and more accurate for simple cases)
    try {
      const [imports] = await parse(source);

      if (imports && imports.length > 0) {
        return await resolveImports(imports as ImportSpecifier[], source, filePath);
      }
    } catch (lexerError) {
      // es-module-lexer failed, fall back to regex-based extraction
      // This is common with TypeScript files that have complex syntax
    }

    // Fallback: Use regex-based extraction (more forgiving with TypeScript)
    const regexImports = extractImportPathsWithRegex(source);
    const resolvedImports = new Map<string, ResolvedImport>();

    for (const { path: importPath, isTypeOnly } of regexImports) {
      if (isNodeBuiltin(importPath)) {
        continue;
      }

      if (!importPath.startsWith(".") && !tsconfigManager.isAlias(importPath)) {
        continue;
      }

      let resolvedPath: string | null = null;

      if (tsconfigManager.isAlias(importPath)) {
        resolvedPath = await resolveAliasImport(importPath);
      } else if (importPath.startsWith(".")) {
        resolvedPath = await resolveRelativeImport(importPath, filePath);
      }

      if (resolvedPath) {
        mergeResolvedImport(resolvedImports, importPath, resolvedPath, isTypeOnly);
      }
    }

    return resolvedImports;
  } catch (error) {
    console.error(`Error parsing imports for ${filePath}:`, error);

    return new Map();
  }
}

/**
 * Merge a resolved import into the output map, preserving the type-only rule:
 * a path is type-only iff every statement that references it is type-only.
 */
function mergeResolvedImport(
  target: Map<string, ResolvedImport>,
  importPath: string,
  absolutePath: string,
  isTypeOnly: boolean,
): void {
  const existing = target.get(importPath);

  if (!existing) {
    target.set(importPath, { absolutePath, isTypeOnly });

    return;
  }

  if (!isTypeOnly) {
    existing.isTypeOnly = false;
  }
}

/**
 * Resolve imports from `es-module-lexer` output. For each specifier, slice the
 * raw statement (`ss..se`) and re-run the type-only heuristic so we can flag
 * the edge correctly â€” the lexer itself does not distinguish `import type`.
 */
async function resolveImports(
  imports: ImportSpecifier[],
  source: string,
  filePath: string,
): Promise<Map<string, ResolvedImport>> {
  const resolvedImports = new Map<string, ResolvedImport>();

  for (const imp of imports) {
    const importPath = imp.n;

    if (!importPath) {
      continue;
    }

    if (isNodeBuiltin(importPath)) {
      continue;
    }

    if (!importPath.startsWith(".") && !tsconfigManager.isAlias(importPath)) {
      continue;
    }

    let resolvedPath: string | null = null;

    if (tsconfigManager.isAlias(importPath)) {
      resolvedPath = await resolveAliasImport(importPath);
    } else if (importPath.startsWith(".")) {
      resolvedPath = await resolveRelativeImport(importPath, filePath);
    }

    if (!resolvedPath) {
      continue;
    }

    const isTypeOnly = isLexerStatementTypeOnly(imp, source);

    mergeResolvedImport(resolvedImports, importPath, resolvedPath, isTypeOnly);
  }

  return resolvedImports;
}

/**
 * Classify a single lexer-reported statement as type-only or runtime.
 * Dynamic imports (`import(...)`) are always runtime. For static
 * imports/export-from we slice the raw source and apply the same heuristic
 * the regex fallback uses.
 */
function isLexerStatementTypeOnly(imp: ImportSpecifier, source: string): boolean {
  // Dynamic imports always execute â€” they cannot be type-only.
  // es-module-lexer reports dynamic with a.n === undefined typically, but
  // we guard by checking the statement prefix too.
  const statementStart = imp.ss;
  const statementEnd = imp.se;

  if (
    typeof statementStart !== "number" ||
    typeof statementEnd !== "number" ||
    statementEnd <= statementStart
  ) {
    return false;
  }

  const statement = source.slice(statementStart, statementEnd);
  const trimmed = statement.trim();

  if (trimmed.startsWith("import(") || /^\bimport\s*\(/.test(trimmed)) {
    return false;
  }

  if (trimmed.startsWith("export")) {
    return isExportTypeOnlyStatement(statement);
  }

  return !hasRuntimeImports(statement);
}

/**
 * Resolve alias imports to actual file paths with extensions
 * Example: app/users/services/get-users.service -> /absolute/path/to/src/app/users/services/get-users.service.ts
 */
async function resolveAliasImport(importPath: string): Promise<string | null> {
  // Use tsconfig manager to resolve the alias to an absolute path
  const resolvedBase = tsconfigManager.resolveAliasToAbsolute(importPath);

  if (!resolvedBase) return null;

  // Try to resolve with extensions
  const resolvedPath = await tryResolveWithExtensions(resolvedBase);

  return resolvedPath;
}

/**
 * Resolve relative imports to actual file paths
 * Example: ./../services/get-user.service -> /absolute/path/to/services/get-user.service.ts
 */
async function resolveRelativeImport(
  importPath: string,
  currentFilePath: string,
): Promise<string | null> {
  const dir = path.dirname(currentFilePath);
  // Use path.resolve to handle .. and . properly, then normalize to forward slashes
  const resolvedBase = Path.normalize(path.resolve(dir, importPath));

  // Try to resolve with extensions
  const resolvedPath = await tryResolveWithExtensions(resolvedBase);

  return resolvedPath;
}

/**
 * Try to resolve a file path by checking different extensions
 * TypeScript/JavaScript files can be imported without extensions
 *
 * @TODO: For better performance, we need to check the files in files orchestrator
 * instead of using the file system as we will be fetching all project files anyway.
 */
// Cache for file existence checks to avoid redundant filesystem calls
const fileExistsCache = new Map<string, boolean>();

/**
 * Clear the file exists cache
 * Should be called when new files are created to ensure fresh lookups
 */
export function clearFileExistsCache(): void {
  fileExistsCache.clear();
}

async function cachedFileExists(filePath: string): Promise<boolean> {
  if (fileExistsCache.has(filePath)) {
    return fileExistsCache.get(filePath)!;
  }
  const exists = (await fileExistsAsync(filePath)) as boolean;
  fileExistsCache.set(filePath, exists);
  return exists;
}

async function tryResolveWithExtensions(basePath: string): Promise<string | null> {
  // Normalize the base path first (handle Windows paths)
  const normalizedBase = Path.normalize(basePath);

  // List of extensions to try, in order of preference
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  const validExtensions = new Set(extensions);

  // If the path already has a VALID code file extension, check if it exists
  const ext = path.extname(normalizedBase);
  if (ext && validExtensions.has(ext)) {
    if (await cachedFileExists(normalizedBase)) {
      return normalizedBase;
    }
    // If explicit extension doesn't exist, return null
    return null;
  }

  // Try all extensions in parallel for better performance
  const pathsToCheck = extensions.map((extension) => normalizedBase + extension);
  const results = await Promise.all(
    pathsToCheck.map(async (p) => ({ path: p, exists: await cachedFileExists(p) })),
  );

  // Return the first one that exists (in order of preference)
  for (const result of results) {
    if (result.exists) {
      return result.path;
    }
  }

  // Try index files in directory
  if (await directoryExistsAsync(normalizedBase)) {
    const indexPaths = extensions.map((extension) =>
      Path.join(normalizedBase, `index${extension}`),
    );
    const indexResults = await Promise.all(
      indexPaths.map(async (p) => ({ path: p, exists: await cachedFileExists(p) })),
    );

    for (const result of indexResults) {
      if (result.exists) {
        return result.path;
      }
    }
  }

  return null;
}

/**
 * Check if import is a Node.js built-in module
 */
function isNodeBuiltin(importPath: string): boolean {
  const builtins = [
    "fs",
    "path",
    "http",
    "https",
    "crypto",
    "stream",
    "util",
    "events",
    "buffer",
    "child_process",
    "os",
    "url",
    "querystring",
    "zlib",
    "net",
    "tls",
    "dns",
    "dgram",
    "cluster",
    "worker_threads",
    "perf_hooks",
    "async_hooks",
    "timers",
    "readline",
    "repl",
    "vm",
    "assert",
    "console",
    "process",
    "v8",
  ];

  // Check for node: prefix or direct builtin name
  if (importPath.startsWith("node:")) return true;

  const moduleName = importPath.split("/")[0];
  return builtins.includes(moduleName);
}
