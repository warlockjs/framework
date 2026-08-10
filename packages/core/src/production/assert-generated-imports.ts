import { builtinModules } from "node:module";

/**
 * A specifier the builder wrote into generated code that the consuming app does
 * not declare.
 */
export type UndeclaredImport = {
  /** File the import was written into, relative to the generation directory. */
  file: string;
  /** The specifier exactly as emitted. */
  specifier: string;
  /** The package the specifier resolves to — `@scope/name` for a deep import. */
  packageName: string;
};

export type GeneratedFile = {
  file: string;
  content: string;
};

/**
 * Raised when generated code would ship an import the app cannot resolve.
 *
 * Carries every violation rather than the first, so a build reports the whole
 * problem in one pass instead of one specifier per re-run.
 */
export class UndeclaredGeneratedImportError extends Error {
  public constructor(public readonly violations: UndeclaredImport[]) {
    super(
      [
        `Generated code imports ${violations.length} package(s) the application does not declare:`,
        "",
        ...violations.map(
          ({ file, specifier, packageName }) =>
            `  ${file} → "${specifier}" (requires "${packageName}" in the app's dependencies)`,
        ),
        "",
        "Generated code may only import packages the app itself declares. A framework-internal",
        "dependency must be reached through a re-export from @warlock.js/core — a bare specifier",
        "resolves by accident under npm/yarn hoisting and fails under pnpm's strict layout.",
      ].join("\n"),
    );

    this.name = "UndeclaredGeneratedImportError";
  }
}

// The clause between `import` and `from` excludes `;` and both quote
// characters so the lazy match cannot run past the end of its own statement.
// Allowing it to would let a side-effect import (`import "./bootstrap";`) bind
// to the `from` of the NEXT statement and disappear from the results.
const IMPORT_PATTERN =
  /(?:import|export)\s+(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Every module specifier a source file references — static, side-effect,
 * re-export and dynamic `import()` forms alike.
 *
 * Regex is sufficient and deliberate here: the input is code this builder wrote
 * itself, so it has no comments, no strings that look like imports, and no
 * syntax the pattern could misread. Parsing it with a full AST would buy
 * nothing and cost a dependency in the build path.
 */
export function extractSpecifiers(content: string): string[] {
  const specifiers: string[] = [];

  for (const match of content.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2];

    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

/**
 * The package a specifier resolves to — `@scope/name` or `name`, ignoring any
 * deep path after it. Returns undefined for anything that is not a package:
 * relative paths, absolute paths, URLs, and Node builtins.
 */
export function resolvePackageName(specifier: string): string | undefined {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:") ||
    specifier.includes("://")
  ) {
    return undefined;
  }

  const segments = specifier.split("/");
  const packageName = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];

  if (builtinModules.includes(packageName)) {
    return undefined;
  }

  return packageName;
}

/**
 * Find every import in generated code that the app does not declare.
 *
 * `dependencies` only, deliberately: the artifact this checks is a production
 * bundle, so a package the app lists as a dev dependency is not guaranteed to
 * be installed where it runs.
 */
export function findUndeclaredImports(
  files: GeneratedFile[],
  declaredDependencies: string[],
): UndeclaredImport[] {
  const declared = new Set(declaredDependencies);
  const violations: UndeclaredImport[] = [];

  for (const { file, content } of files) {
    for (const specifier of extractSpecifiers(content)) {
      const packageName = resolvePackageName(specifier);

      if (!packageName || declared.has(packageName)) {
        continue;
      }

      violations.push({ file, specifier, packageName });
    }
  }

  return violations;
}

/**
 * Fail the build when generated code would import something the app cannot
 * resolve.
 *
 * This is the part that stops the defect class from returning. Rewriting the
 * one bad specifier fixes today's bundle; only the assertion stops the next
 * change to the generator from reintroducing it — under npm or yarn the mistake
 * is invisible, because hoisting resolves it by accident.
 *
 * @throws {UndeclaredGeneratedImportError} listing every violation found.
 */
export function assertGeneratedImportsAreDeclared(
  files: GeneratedFile[],
  declaredDependencies: string[],
): void {
  const violations = findUndeclaredImports(files, declaredDependencies);

  if (violations.length > 0) {
    throw new UndeclaredGeneratedImportError(violations);
  }
}
