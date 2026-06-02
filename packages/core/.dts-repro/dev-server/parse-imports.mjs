import { Path } from "./path.mjs";
import { tsconfigManager } from "./tsconfig-manager.mjs";
import { directoryExistsAsync, fileExistsAsync } from "@warlock.js/fs";
import path from "node:path";
import { parse } from "es-module-lexer";
//#region ../../@warlock.js/core/src/dev-server/parse-imports.ts
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
function isTypeOnlyFile(source) {
	const withoutStrings = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, "\"\"").replace(/`(?:[^`\\]|\\.)*`/g, "``");
	const typeOnlyPatterns = [
		/export\s+type\s+\{[^}]*\}/g,
		/export\s+type\s+\{[^}]*\}\s+from\s+['"]/g,
		/export\s+interface\s+\w+/g,
		/export\s+type\s+\w+\s*=/g
	];
	let remaining = withoutStrings;
	for (const pattern of typeOnlyPatterns) remaining = remaining.replace(pattern, "");
	for (const pattern of [
		/export\s+(?:const|let|var)\s+\w+/g,
		/export\s+function\s+\w+/g,
		/export\s+async\s+function\s+\w+/g,
		/export\s+class\s+\w+/g,
		/export\s+enum\s+\w+/g,
		/export\s+default\s+(?!type\s)/g,
		/export\s+\{[^}]*\}(?!\s+from)/g,
		/export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]/g,
		/export\s+\*\s+from\s+['"][^'"]+['"]/g,
		/export\s+\*\s+as\s+\w+/g
	]) if (pattern.test(remaining)) {
		pattern.lastIndex = 0;
		if (pattern.source.includes("export\\s+\\{")) {
			const matches = remaining.match(/export\s+\{([^}]*)\}(?:\s+from\s+['"][^'"]+['"])?/g);
			if (matches) for (const match of matches) {
				if (/^export\s+type\s+/.test(match)) continue;
				const specifiersMatch = match.match(/export\s+\{([^}]*)\}/);
				if (specifiersMatch) {
					if (specifiersMatch[1].split(",").map((s) => s.trim()).filter(Boolean).some((item) => !item.startsWith("type "))) return false;
				}
			}
			continue;
		}
		return false;
	}
	return typeOnlyPatterns.some((pattern) => {
		pattern.lastIndex = 0;
		return pattern.test(withoutStrings);
	});
}
/**
* Check if an import statement is a pure `import type` (the keyword sits
* immediately after `import`, covering `import type { X }`, `import type Foo`,
* and `import type * as Ns`).
*/
function isTypeOnlyImport(line) {
	const trimmed = line.trim();
	return trimmed.startsWith("import type ") || !!trimmed.match(/^import\s+type\s+[\{\*]/);
}
/**
* Decide whether an `import ... from "m"` statement contributes any runtime
* binding. Returns false for pure `import type` and for destructured imports
* where every specifier is prefixed with the `type` keyword.
*/
function hasRuntimeImports(line) {
	const trimmed = line.trim();
	if (isTypeOnlyImport(trimmed)) return false;
	const specifiersMatch = trimmed.match(/import\s+(?:type\s+)?\{([^}]+)\}/);
	if (!specifiersMatch) return true;
	return !specifiersMatch[1].split(",").map((s) => s.trim()).filter(Boolean).every((item) => /^type\s+\w+/.test(item));
}
/**
* Decide whether an `export ... from "m"` statement re-exports only types.
* Covers `export type { X } from`, `export type * from`, and
* `export { type X, type Y } from`.
*/
function isExportTypeOnlyStatement(line) {
	const trimmed = line.trim();
	if (/^export\s+type\s+/.test(trimmed)) return true;
	const specifiersMatch = trimmed.match(/export\s+\{([^}]+)\}/);
	if (!specifiersMatch) return false;
	return specifiersMatch[1].split(",").map((s) => s.trim()).filter(Boolean).every((item) => /^type\s+\w+/.test(item));
}
/**
* Extract import paths using regex (more reliable for TypeScript).
* Each entry carries an `isTypeOnly` flag: true when every occurrence of the
* path in the source is a type-only statement (no runtime binding).
* A single runtime occurrence makes the path runtime.
*/
function extractImportPathsWithRegex(source) {
	const imports = [];
	const seenPaths = /* @__PURE__ */ new Map();
	/**
	* Record an import path with its type-only flag.
	* If the same path appears in multiple statements, the edge is type-only
	* iff every occurrence is type-only â€” a single runtime statement makes it runtime.
	*/
	const record = (importPath, originalLine, isTypeOnly) => {
		if (!importPath) return;
		const existingIndex = seenPaths.get(importPath);
		if (existingIndex === void 0) {
			seenPaths.set(importPath, imports.length);
			imports.push({
				path: importPath,
				originalLine,
				isTypeOnly
			});
			return;
		}
		if (!isTypeOnly) imports[existingIndex].isTypeOnly = false;
	};
	const importRegex = /import\s+(?:type\s+)?(\{[\s\S]*?\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{[\s\S]*?\})?)\s+from\s+['"]([^'"]+)['"]/g;
	let match;
	while ((match = importRegex.exec(source)) !== null) {
		const fullMatch = match[0];
		const importPath = match[2];
		record(importPath, fullMatch, !hasRuntimeImports(fullMatch));
	}
	const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;
	while ((match = sideEffectRegex.exec(source)) !== null) record(match[1], match[0], false);
	const dynamicImportPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
	while ((match = dynamicImportPattern.exec(source)) !== null) record(match[1], match[0], false);
	const exportFromPattern = /export\s+(?:\{[^}]*\}|\*|\w+)\s+from\s+['"]([^'"]+)['"]/g;
	while ((match = exportFromPattern.exec(source)) !== null) {
		const fullMatch = match[0];
		record(match[1], fullMatch, isExportTypeOnlyStatement(fullMatch));
	}
	return imports;
}
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
async function parseImports(source, filePath) {
	try {
		if (filePath.endsWith(".d.ts")) return /* @__PURE__ */ new Map();
		try {
			const [imports] = await parse(source);
			if (imports && imports.length > 0) return await resolveImports(imports, source, filePath);
		} catch (lexerError) {}
		const regexImports = extractImportPathsWithRegex(source);
		const resolvedImports = /* @__PURE__ */ new Map();
		for (const { path: importPath, isTypeOnly } of regexImports) {
			if (isNodeBuiltin(importPath)) continue;
			if (!importPath.startsWith(".") && !tsconfigManager.isAlias(importPath)) continue;
			let resolvedPath = null;
			if (tsconfigManager.isAlias(importPath)) resolvedPath = await resolveAliasImport(importPath);
			else if (importPath.startsWith(".")) resolvedPath = await resolveRelativeImport(importPath, filePath);
			if (resolvedPath) mergeResolvedImport(resolvedImports, importPath, resolvedPath, isTypeOnly);
		}
		return resolvedImports;
	} catch (error) {
		console.error(`Error parsing imports for ${filePath}:`, error);
		return /* @__PURE__ */ new Map();
	}
}
/**
* Merge a resolved import into the output map, preserving the type-only rule:
* a path is type-only iff every statement that references it is type-only.
*/
function mergeResolvedImport(target, importPath, absolutePath, isTypeOnly) {
	const existing = target.get(importPath);
	if (!existing) {
		target.set(importPath, {
			absolutePath,
			isTypeOnly
		});
		return;
	}
	if (!isTypeOnly) existing.isTypeOnly = false;
}
/**
* Resolve imports from `es-module-lexer` output. For each specifier, slice the
* raw statement (`ss..se`) and re-run the type-only heuristic so we can flag
* the edge correctly â€” the lexer itself does not distinguish `import type`.
*/
async function resolveImports(imports, source, filePath) {
	const resolvedImports = /* @__PURE__ */ new Map();
	for (const imp of imports) {
		const importPath = imp.n;
		if (!importPath) continue;
		if (isNodeBuiltin(importPath)) continue;
		if (!importPath.startsWith(".") && !tsconfigManager.isAlias(importPath)) continue;
		let resolvedPath = null;
		if (tsconfigManager.isAlias(importPath)) resolvedPath = await resolveAliasImport(importPath);
		else if (importPath.startsWith(".")) resolvedPath = await resolveRelativeImport(importPath, filePath);
		if (!resolvedPath) continue;
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
function isLexerStatementTypeOnly(imp, source) {
	const statementStart = imp.ss;
	const statementEnd = imp.se;
	if (typeof statementStart !== "number" || typeof statementEnd !== "number" || statementEnd <= statementStart) return false;
	const statement = source.slice(statementStart, statementEnd);
	const trimmed = statement.trim();
	if (trimmed.startsWith("import(") || /^\bimport\s*\(/.test(trimmed)) return false;
	if (trimmed.startsWith("export")) return isExportTypeOnlyStatement(statement);
	return !hasRuntimeImports(statement);
}
/**
* Resolve alias imports to actual file paths with extensions
* Example: app/users/services/get-users.service -> /absolute/path/to/src/app/users/services/get-users.service.ts
*/
async function resolveAliasImport(importPath) {
	const resolvedBase = tsconfigManager.resolveAliasToAbsolute(importPath);
	if (!resolvedBase) return null;
	return await tryResolveWithExtensions(resolvedBase);
}
/**
* Resolve relative imports to actual file paths
* Example: ./../services/get-user.service -> /absolute/path/to/services/get-user.service.ts
*/
async function resolveRelativeImport(importPath, currentFilePath) {
	const dir = path.dirname(currentFilePath);
	return await tryResolveWithExtensions(Path.normalize(path.resolve(dir, importPath)));
}
/**
* Try to resolve a file path by checking different extensions
* TypeScript/JavaScript files can be imported without extensions
*
* @TODO: For better performance, we need to check the files in files orchestrator
* instead of using the file system as we will be fetching all project files anyway.
*/
const fileExistsCache = /* @__PURE__ */ new Map();
/**
* Clear the file exists cache
* Should be called when new files are created to ensure fresh lookups
*/
function clearFileExistsCache() {
	fileExistsCache.clear();
}
async function cachedFileExists(filePath) {
	if (fileExistsCache.has(filePath)) return fileExistsCache.get(filePath);
	const exists = await fileExistsAsync(filePath);
	fileExistsCache.set(filePath, exists);
	return exists;
}
async function tryResolveWithExtensions(basePath) {
	const normalizedBase = Path.normalize(basePath);
	const extensions = [
		".ts",
		".tsx",
		".js",
		".jsx",
		".mjs",
		".cjs"
	];
	const validExtensions = new Set(extensions);
	const ext = path.extname(normalizedBase);
	if (ext && validExtensions.has(ext)) {
		if (await cachedFileExists(normalizedBase)) return normalizedBase;
		return null;
	}
	const pathsToCheck = extensions.map((extension) => normalizedBase + extension);
	const results = await Promise.all(pathsToCheck.map(async (p) => ({
		path: p,
		exists: await cachedFileExists(p)
	})));
	for (const result of results) if (result.exists) return result.path;
	if (await directoryExistsAsync(normalizedBase)) {
		const indexPaths = extensions.map((extension) => Path.join(normalizedBase, `index${extension}`));
		const indexResults = await Promise.all(indexPaths.map(async (p) => ({
			path: p,
			exists: await cachedFileExists(p)
		})));
		for (const result of indexResults) if (result.exists) return result.path;
	}
	return null;
}
/**
* Check if import is a Node.js built-in module
*/
function isNodeBuiltin(importPath) {
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
		"v8"
	];
	if (importPath.startsWith("node:")) return true;
	const moduleName = importPath.split("/")[0];
	return builtins.includes(moduleName);
}
//#endregion
export { clearFileExistsCache, isTypeOnlyFile, parseImports };

//# sourceMappingURL=parse-imports.mjs.map