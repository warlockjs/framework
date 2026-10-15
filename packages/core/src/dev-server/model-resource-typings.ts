import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative } from "node:path";
import ts from "typescript";

/**
 * Static `ModelResourceRegistry` generation.
 *
 * `Serialized<User>` can only resolve a model to its resource output through an
 * entry in the augmentable `ModelResourceRegistry` (see `http/serialized.ts`).
 * This module derives those entries from source: a model class that declares
 * `static resource = UserResource` produces
 *
 * ```ts
 * "User": { model: import("<model file>").User; resource: typeof import("<resource file>").UserResource };
 * ```
 *
 * Everything here is syntactic. It reads one `ts.createSourceFile` AST per model
 * file, follows the identifier through that file's own imports, and never
 * imports or executes application code (`read-config-ast.ts` explains why a
 * type checker is not an option). Anything it cannot prove from the AST alone
 * (a computed expression, `lazy(...)`, a namespace import, a class that is not
 * exported) is skipped, and nothing is recorded for it: a guessed entry would
 * make `Serialized` lie, which is worse than the raw-data type it falls back to.
 */

/** One model class whose resource could be resolved statically. */
export type ModelResourceEntry = {
  /** The model class name (the registry key before de-duplication). */
  className: string;
  /** Absolute path of the model file. */
  modelFile: string;
  /** How the model file exports the class: its export name, or `"default"`. */
  modelExport: string;
  /** Absolute path of the module that exports the resource. */
  resourceFile: string;
  /** How that module exports the resource: its export name, or `"default"`. */
  resourceExport: string;
};

/** A model that declares `static resource` but could not be resolved. */
export type SkippedModelResource = {
  className: string;
  modelFile: string;
  reason: string;
};

export type ModelResourceExtraction = {
  entries: ModelResourceEntry[];
  skipped: SkippedModelResource[];
};

export type ExtractModelResourcesInput = {
  /** Source text of the model file. */
  source: string;
  /** Absolute path of the model file. */
  absolutePath: string;
  /**
   * Resolve an import specifier of the model file (relative or tsconfig alias) to
   * an absolute file path, or `undefined` when it does not point at app source.
   */
  resolveImport: (specifier: string) => string | undefined;
};

type ImportBinding = { specifier: string; exportName: string };

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }

  return current;
}

/** Top-level names this file declares, and the names each is exported under. */
function readLocalDeclarations(sourceFile: ts.SourceFile): {
  declared: Set<string>;
  exportNames: Map<string, string[]>;
} {
  const declared = new Set<string>();
  const exportNames = new Map<string, string[]>();

  const addExport = (local: string, exported: string): void => {
    const names = exportNames.get(local) ?? [];

    names.push(exported);
    exportNames.set(local, names);
  };

  for (const statement of sourceFile.statements) {
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);

    if (
      (ts.isClassDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      declared.add(statement.name.text);

      if (exported) {
        addExport(statement.name.text, isDefault ? "default" : statement.name.text);
      }

      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;

        declared.add(declaration.name.text);

        if (exported) {
          addExport(declaration.name.text, declaration.name.text);
        }
      }

      continue;
    }

    // `export { A, B as C }` (local form only; a `from` clause re-exports a foreign name).
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;

        addExport((element.propertyName ?? element.name).text, element.name.text);
      }

      continue;
    }

    // `export default UserResource;`
    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ts.isIdentifier(statement.expression)
    ) {
      addExport(statement.expression.text, "default");
    }
  }

  return { declared, exportNames };
}

/** Prefer a named export over `default`; among named exports, the first sorted. */
function pickExportName(names: readonly string[] | undefined): string | undefined {
  if (!names || names.length === 0) return undefined;

  const named = names.filter((name) => name !== "default").sort();

  return named[0] ?? "default";
}

function readImportBindings(sourceFile: ts.SourceFile): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const clause = statement.importClause;
    const specifier = statement.moduleSpecifier.text;

    if (!clause) continue;

    if (clause.name) {
      bindings.set(clause.name.text, { specifier, exportName: "default" });
    }

    // A namespace import (`import * as ns`) cannot be the bare identifier a
    // `static resource = X` reads, so it never becomes a binding.
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        bindings.set(element.name.text, {
          specifier,
          exportName: (element.propertyName ?? element.name).text,
        });
      }
    }
  }

  return bindings;
}

/** The identifier a class assigns to `static resource`, when it is a bare identifier. */
function readStaticResourceReference(
  member: ts.ClassElement,
): { name: string } | "computed" | undefined {
  if (!ts.isPropertyDeclaration(member)) return undefined;
  if (!hasModifier(member, ts.SyntaxKind.StaticKeyword)) return undefined;
  if (hasModifier(member, ts.SyntaxKind.DeclareKeyword)) return undefined;

  const isResourceName =
    (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
    member.name.text === "resource";

  if (!isResourceName) return undefined;
  if (!member.initializer) return undefined;

  const initializer = unwrapParentheses(member.initializer);

  return ts.isIdentifier(initializer) ? { name: initializer.text } : "computed";
}

/**
 * Read every model class of one file that declares `static resource = <Identifier>`
 * and resolve it to a model export plus a resource export. Pure: the only
 * outside knowledge is the injected {@link ExtractModelResourcesInput.resolveImport}.
 */
export function extractModelResourceEntries(
  input: ExtractModelResourcesInput,
): ModelResourceExtraction {
  const result: ModelResourceExtraction = { entries: [], skipped: [] };

  // Cheap exit: most model files declare no resource.
  if (!input.source.includes("resource")) return result;

  const sourceFile = ts.createSourceFile(
    input.absolutePath,
    input.source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ false,
    input.absolutePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const { declared, exportNames } = readLocalDeclarations(sourceFile);
  const imports = readImportBindings(sourceFile);

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || !statement.name) continue;

    const className = statement.name.text;

    let reference: { name: string } | "computed" | undefined;

    for (const member of statement.members) {
      reference = readStaticResourceReference(member) ?? reference;
    }

    if (reference === undefined) continue;

    const skip = (reason: string): void => {
      result.skipped.push({ className, modelFile: input.absolutePath, reason });
    };

    if (reference === "computed") {
      skip("`static resource` is not a plain identifier");
      continue;
    }

    const requiresTypeArguments = statement.typeParameters?.some(
      (parameter) => parameter.default === undefined,
    );

    if (requiresTypeArguments) {
      skip("the model class is generic");
      continue;
    }

    const modelExport = pickExportName(exportNames.get(className));

    if (modelExport === undefined) {
      skip("the model class is not exported");
      continue;
    }

    if (modelExport !== "default" && !IDENTIFIER.test(modelExport)) {
      skip("the model export name is not an identifier");
      continue;
    }

    const binding = imports.get(reference.name);

    let resourceFile: string | undefined;
    let resourceExport: string | undefined;

    if (binding) {
      resourceFile = input.resolveImport(binding.specifier);
      resourceExport = binding.exportName;
    } else if (declared.has(reference.name)) {
      resourceFile = input.absolutePath;
      resourceExport = pickExportName(exportNames.get(reference.name));
    }

    if (resourceFile === undefined || resourceExport === undefined) {
      skip(`\`${reference.name}\` cannot be resolved to an exported module member`);
      continue;
    }

    if (resourceExport !== "default" && !IDENTIFIER.test(resourceExport)) {
      skip("the resource export name is not an identifier");
      continue;
    }

    result.entries.push({
      className,
      modelFile: input.absolutePath,
      modelExport,
      resourceFile,
      resourceExport,
    });
  }

  return result;
}

/** Module specifier, relative to the typings directory, without a TypeScript extension. */
function toTypeImportSpecifier(typingsDirectory: string, absoluteFile: string): string | undefined {
  const path = relative(typingsDirectory, absoluteFile).replaceAll("\\", "/");

  // A different drive (Windows) has no relative form; do not emit a guess.
  if (isAbsolute(path)) return undefined;

  const withoutExtension = path.replace(/\.(?:d\.)?(?:ts|tsx|mts|cts)$/, "");

  return withoutExtension.startsWith(".") ? withoutExtension : `./${withoutExtension}`;
}

/**
 * Registry keys: the class name, suffixed `_2`, `_3`, ... when several model
 * files declare the same class name. Order is by class name, then by file path,
 * so the same set of models always yields the same keys and the same text.
 */
export function assignRegistryKeys(
  entries: readonly ModelResourceEntry[],
): Array<{ key: string; entry: ModelResourceEntry }> {
  const sorted = [...entries].sort(
    (a, b) =>
      a.className.localeCompare(b.className, "en") ||
      a.modelFile.localeCompare(b.modelFile, "en") ||
      a.modelExport.localeCompare(b.modelExport, "en"),
  );

  const taken = new Set<string>();
  const counts = new Map<string, number>();

  return sorted.map((entry) => {
    let count = (counts.get(entry.className) ?? 0) + 1;
    let key = count === 1 ? entry.className : `${entry.className}_${count}`;

    while (taken.has(key)) {
      count += 1;
      key = `${entry.className}_${count}`;
    }

    counts.set(entry.className, count);
    taken.add(key);

    return { key, entry };
  });
}

/**
 * Text of the generated declaration file.
 *
 * @param entries Every resolved model, in any order.
 * @param typingsDirectory Absolute directory the file is written to; import
 * specifiers are relative to it.
 */
export function renderModelResourceRegistry(
  entries: readonly ModelResourceEntry[],
  typingsDirectory: string,
): string {
  const lines: string[] = [];

  for (const { key, entry } of assignRegistryKeys(entries)) {
    const modelPath = toTypeImportSpecifier(typingsDirectory, entry.modelFile);
    const resourcePath = toTypeImportSpecifier(typingsDirectory, entry.resourceFile);

    if (modelPath === undefined || resourcePath === undefined) continue;

    const model = `import(${JSON.stringify(modelPath)}).${entry.modelExport}`;
    const resource = `typeof import(${JSON.stringify(resourcePath)}).${entry.resourceExport}`;

    lines.push(`    ${JSON.stringify(key)}: { model: ${model}; resource: ${resource} };`);
  }

  return `// Auto-generated by Warlock.js - DO NOT EDIT
// One entry per model class that declares \`static resource = <Resource>\`, so
// \`Serialized<Model>\` resolves to the resource output. Models whose resource
// cannot be resolved statically are left out.

import "@warlock.js/core";

declare module "@warlock.js/core" {
  interface ModelResourceRegistry {
${lines.join("\n")}
  }
}
`;
}

/**
 * Write `content` to `filePath` through a temporary sibling and a rename, so a
 * reader (the editor's TypeScript server) never sees a half-written file, and
 * skip the write entirely when the file already holds exactly this text.
 *
 * @returns `true` when the file was written.
 */
export async function writeFileIfChanged(filePath: string, content: string): Promise<boolean> {
  try {
    if ((await readFile(filePath, "utf-8")) === content) return false;
  } catch {
    // Missing file: write it.
  }

  await mkdir(dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.${process.pid}.tmp`;

  try {
    await writeFile(temporaryPath, content, "utf-8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });

    throw error;
  }

  return true;
}
