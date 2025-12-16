import { fileExists, fileExistsAsync, isDirectoryAsync } from "@mongez/fs";
import { ImportSpecifier, parse } from "es-module-lexer";
import path from "node:path";
import { Path } from "./path";
import { tsconfigManager } from "./tsconfig-manager";

/**
 * Extract import paths using regex (more reliable for TypeScript)
 * This is a fallback when es-module-lexer fails
 */
function extractImportPathsWithRegex(
  source: string,
): Array<{ path: string; originalLine: string }> {
  const imports: Array<{ path: string; originalLine: string }> = [];
  const seenPaths = new Set<string>();

  // Skip type-only imports
  const skipTypeOnlyImports = (line: string): boolean => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith("import type ") ||
      !!trimmed.match(/import\s+type\s+\{/)
    );
  };

  // Pattern 1: Standard ES module imports - look for "from" followed by quoted string
  // Also handle side-effect imports: import "path"
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip type-only imports
    if (skipTypeOnlyImports(trimmed)) {
      continue;
    }

    // Match: ... from "path" or ... from 'path'
    const fromMatch = trimmed.match(/\s+from\s+['"]([^'"]+)['"]/);
    if (fromMatch && trimmed.startsWith("import")) {
      const importPath = fromMatch[1];
      if (importPath && !seenPaths.has(importPath)) {
        seenPaths.add(importPath);
        imports.push({
          path: importPath,
          originalLine: line,
        });
      }
      continue;
    }

    // Match: import "path" (side-effect imports)
    const sideEffectMatch = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
    if (sideEffectMatch) {
      const importPath = sideEffectMatch[1];
      if (importPath && !seenPaths.has(importPath)) {
        seenPaths.add(importPath);
        imports.push({
          path: importPath,
          originalLine: line,
        });
      }
    }
  }

  // Pattern 2: Dynamic imports - import("path")
  const dynamicImportPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = dynamicImportPattern.exec(source)) !== null) {
    const importPath = match[1];
    if (importPath && !seenPaths.has(importPath)) {
      seenPaths.add(importPath);
      imports.push({
        path: importPath,
        originalLine: match[0],
      });
    }
  }

  // Pattern 3: Export from - export ... from "path"
  const exportFromPattern =
    /export\s+(?:\{[^}]*\}|\*|\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = exportFromPattern.exec(source)) !== null) {
    const importPath = match[1];
    if (importPath && !seenPaths.has(importPath)) {
      seenPaths.add(importPath);
      imports.push({
        path: importPath,
        originalLine: match[0],
      });
    }
  }

  return imports;
}

/**
 * This function will transpile the given ts/tsx code to js code
 * // also it will return the dependencies of the file
 *
 * @returns Map of originalImportPath -> resolvedAbsolutePath
 */
export async function parseImports(source: string, filePath: string) {
  try {
    // Skip .d.ts files - they're type declarations, not runtime code
    if (filePath.endsWith(".d.ts")) {
      return new Map<string, string>();
    }

    // Try es-module-lexer first (faster and more accurate for simple cases)
    try {
      const [imports] = await parse(source);
      if (imports && imports.length > 0) {
        return await resolveImports(imports as ImportSpecifier[], filePath);
      }
    } catch (lexerError) {
      // es-module-lexer failed, fall back to regex-based extraction
      // This is common with TypeScript files that have complex syntax
    }

    // Fallback: Use regex-based extraction (more forgiving with TypeScript)
    const regexImports = extractImportPathsWithRegex(source);
    const resolvedImports = new Map<string, string>();

    for (const { path: importPath } of regexImports) {
      // Skip node built-ins and external packages
      if (isNodeBuiltin(importPath)) {
        continue;
      }

      // Skip external node_modules packages (not starting with . or alias)
      if (!importPath.startsWith(".") && !tsconfigManager.isAlias(importPath)) {
        continue;
      }

      let resolvedPath: string | null = null;

      // Handle alias imports
      if (tsconfigManager.isAlias(importPath)) {
        resolvedPath = await resolveAliasImport(importPath);
      } else if (importPath.startsWith(".")) {
        // Handle relative imports
        resolvedPath = await resolveRelativeImport(importPath, filePath);
      }

      if (resolvedPath) {
        resolvedImports.set(importPath, resolvedPath);
      }
    }

    return resolvedImports;
  } catch (error) {
    console.error(`Error parsing imports for ${filePath}:`, error);
    return new Map<string, string>();
  }
}

async function resolveImports(imports: ImportSpecifier[], filePath: string) {
  const resolvedImports = new Map<string, string>();

  for (const imp of imports) {
    const importPath = imp.n;

    if (!importPath) continue;

    // Skip node built-ins and external packages
    if (isNodeBuiltin(importPath)) {
      continue;
    }

    // Skip external node_modules packages (not starting with . or alias)
    if (!importPath.startsWith(".") && !tsconfigManager.isAlias(importPath)) {
      continue;
    }

    let resolvedPath: string | null = null;

    // Handle alias imports (e.g., app/users/services/get-users.service)
    if (tsconfigManager.isAlias(importPath)) {
      resolvedPath = await resolveAliasImport(importPath);
    } else if (importPath.startsWith(".")) {
      // Handle relative imports (e.g., ./../services/get-user.service)
      resolvedPath = await resolveRelativeImport(importPath, filePath);
    }

    if (resolvedPath) {
      // Store mapping: original import path -> resolved absolute path
      resolvedImports.set(importPath, resolvedPath);
    }
  }

  return resolvedImports;
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
async function tryResolveWithExtensions(
  basePath: string,
): Promise<string | null> {
  // Normalize the base path first (handle Windows paths)
  const normalizedBase = Path.normalize(basePath);

  // List of extensions to try, in order of preference
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  const validExtensions = new Set(extensions);

  // If the path already has a VALID code file extension, check if it exists
  const ext = path.extname(normalizedBase);
  if (ext && validExtensions.has(ext)) {
    if (await fileExistsAsync(normalizedBase)) {
      return normalizedBase;
    }
    // If explicit extension doesn't exist, return null
    return null;
  }

  // Try each extension (even if there's already a non-code extension like .service or .repository)
  for (const extension of extensions) {
    const pathWithExt = normalizedBase + extension;
    if (await fileExistsAsync(pathWithExt)) {
      return pathWithExt;
    }
  }

  // Try index files in directory
  if (await isDirectoryAsync(normalizedBase)) {
    for (const extension of extensions) {
      const indexPath = Path.join(normalizedBase, `index${extension}`);
      if (await fileExists(indexPath)) {
        return indexPath;
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
