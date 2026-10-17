import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createProblem, type ToolingProblem } from "../problem";

/** Extensions tried when resolving an extension-less import. */
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];

/** Test files may import anything on purpose. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;

/** Matches a project-relative path of a file the framework loads by itself. */
export function isAutoLoadedFile(relativePath: string): boolean {
  return (
    /^src\/app\/main\.tsx?$/.test(relativePath) ||
    /^src\/app\/[^/]+\/(?:routes|main|worker)\.tsx?$/.test(relativePath) ||
    /^src\/app\/.+\/events\/[^/]+\.tsx?$/.test(relativePath)
  );
}

/** The module folder (`src/app/<module>`) a project-relative path lives in, if any. */
function moduleOf(relativePath: string): string | undefined {
  return /^src\/app\/([^/]+)\//.exec(relativePath)?.[1];
}

function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}

/** Resolve a relative or `app/...` specifier to a project-relative file, if it exists. */
function resolveSpecifier(specifier: string, importer: string, cwd: string): string | undefined {
  let base: string;

  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(path.join(cwd, importer)), specifier);
  } else if (specifier.startsWith("app/")) {
    base = path.join(cwd, "src", specifier);
  } else {
    return undefined;
  }

  const candidates = [base, ...RESOLVE_EXTENSIONS.map((extension) => `${base}${extension}`)];
  const withoutJs = base.replace(/\.jsx?$/, "");

  if (withoutJs !== base) {
    candidates.push(...RESOLVE_EXTENSIONS.map((extension) => `${withoutJs}${extension}`));
  }

  const found = candidates.find(
    (candidate) => existsSync(candidate) && path.extname(candidate) !== "",
  );

  return found ? toPosix(path.relative(cwd, found)) : undefined;
}

/** Every module specifier a source file imports, with its position. */
function importsOf(sourceFile: ts.SourceFile): { specifier: string; node: ts.Node }[] {
  const found: { specifier: string; node: ts.Node }[] = [];

  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push({ specifier: node.moduleSpecifier.text, node: node.moduleSpecifier });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push({ specifier: node.arguments[0].text, node: node.arguments[0] });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

/**
 * The convention problems in one source file:
 *
 * - `WL9001` an import of a file the framework loads by itself (`routes.ts`,
 *   `main.ts`, `worker.ts`, `events/*`) — importing it registers it twice;
 * - `WL9002` a relative import ending in `.js`;
 * - `WL9003` a relative import from one `src/app/<module>` into another, which
 *   should use the `app/<module>/...` alias.
 */
export function checkFileConventions(
  relativePath: string,
  source: string,
  cwd: string,
): ToolingProblem[] {
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  const problems: ToolingProblem[] = [];
  const importerModule = moduleOf(relativePath);

  for (const { specifier, node } of importsOf(sourceFile)) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const at = { file: relativePath, line: position.line + 1, column: position.character + 1 };

    if (specifier.startsWith(".") && /\.jsx?$/.test(specifier)) {
      problems.push(
        createProblem({
          code: "WL9002",
          source: "convention",
          message: `Import "${specifier}" ends in a .js extension.`,
          ...at,
        }),
      );
    }

    const target = resolveSpecifier(specifier, relativePath, cwd);

    if (!target) continue;

    if (!TEST_FILE.test(relativePath) && isAutoLoadedFile(target)) {
      problems.push(
        createProblem({
          code: "WL9001",
          source: "convention",
          message: `"${specifier}" imports ${target}, which the framework loads by itself.`,
          ...at,
        }),
      );
    }

    const targetModule = moduleOf(target);

    if (
      specifier.startsWith(".") &&
      importerModule !== undefined &&
      targetModule !== undefined &&
      importerModule !== targetModule
    ) {
      const alias = `app/${target.replace(/^src\/app\//, "").replace(/\.[cm]?[jt]sx?$/, "")}`;

      problems.push(
        createProblem({
          code: "WL9003",
          source: "convention",
          message: `"${specifier}" reaches from module "${importerModule}" into "${targetModule}"; import "${alias}" instead.`,
          ...at,
        }),
      );
    }
  }

  return problems;
}

/** `WL9004` when the project tsconfig turns on legacy decorators. */
export function checkTsconfigConventions(cwd: string, project = "tsconfig.json"): ToolingProblem[] {
  const file = path.join(cwd, project);

  if (!existsSync(file)) return [];

  const text = readFileSync(file, "utf8");
  const read = ts.parseConfigFileTextToJson(file, text);
  const options: unknown =
    typeof read.config === "object" && read.config !== null
      ? Reflect.get(read.config, "compilerOptions")
      : undefined;

  if (
    typeof options !== "object" ||
    options === null ||
    Reflect.get(options, "experimentalDecorators") !== true
  ) {
    return [];
  }

  const index = text.indexOf("experimentalDecorators");
  const before = index === -1 ? "" : text.slice(0, index);
  const line = index === -1 ? null : before.split("\n").length;
  const column = index === -1 ? null : index - before.lastIndexOf("\n");

  return [
    createProblem({
      code: "WL9004",
      source: "convention",
      message: '"experimentalDecorators": true switches TypeScript to legacy decorators.',
      file: toPosix(project),
      line,
      column,
    }),
  ];
}

/**
 * Run every convention check over `files` (project-relative) plus the
 * project tsconfig.
 */
export function runConventions(
  cwd: string,
  files: readonly string[],
  project?: string,
): ToolingProblem[] {
  const problems = checkTsconfigConventions(cwd, project);

  for (const file of files) {
    let source: string;

    try {
      source = readFileSync(path.join(cwd, file), "utf8");
    } catch {
      continue;
    }

    problems.push(...checkFileConventions(file, source, cwd));
  }

  return problems;
}
