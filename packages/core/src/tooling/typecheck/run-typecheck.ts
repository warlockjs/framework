import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createProblem, type ToolingProblem } from "../problem";

/** Inputs of {@link runTypecheck}. */
export type TypecheckOptions = {
  /** Project root. Default: `process.cwd()`. */
  cwd?: string;
  /** tsconfig path, relative to `cwd`. Default: `tsconfig.json`. */
  project?: string;
  /**
   * Limit diagnostics to these files (relative to `cwd` or absolute) and the
   * project files that import them directly. Omit for the whole program.
   */
  files?: readonly string[];
  /** Where the incremental state is kept. Default: `.warlock/cache/typecheck.tsbuildinfo`. */
  buildInfoFile?: string;
};

/** The outcome of {@link runTypecheck}. */
export type TypecheckResult = {
  /** `true` when no error-severity problem was found. */
  ok: boolean;
  /** `program` = every file; `files` = the given files and their direct importers. */
  mode: "program" | "files";
  /** Project-relative files whose diagnostics were collected in `files` mode, else `null`. */
  files: string[] | null;
  /** Number of source files checked. */
  checkedFiles: number;
  problems: ToolingProblem[];
  durationMs: number;
  /** Absolute path of the incremental state file, or `null` when nothing was written. */
  buildInfoFile: string | null;
};

/** Default location of the incremental state, under the framework's own folder. */
export const DEFAULT_TYPECHECK_BUILD_INFO = path.join(".warlock", "cache", "typecheck.tsbuildinfo");

function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}

/** Whether a program file belongs to the project (under the root, outside node_modules). */
function isProjectFile(fileName: string, root: string, declarations = true): boolean {
  const normalized = path.resolve(fileName);

  return (
    normalized.startsWith(root + path.sep) &&
    !normalized.split(path.sep).includes("node_modules") &&
    (declarations || !normalized.endsWith(".d.ts"))
  );
}

/** Map one TypeScript diagnostic to a problem (`WL7101`, `rule: "TS<code>"`). */
export function diagnosticToProblem(
  diagnostic: ts.Diagnostic,
  cwd: string,
  code: "WL7101" | "WL7102" = "WL7101",
): ToolingProblem | undefined {
  if (
    diagnostic.category !== ts.DiagnosticCategory.Error &&
    diagnostic.category !== ts.DiagnosticCategory.Warning
  ) {
    return undefined;
  }

  let file: string | null = null;
  let line: number | null = null;
  let column: number | null = null;

  if (diagnostic.file) {
    file = toPosix(path.relative(cwd, diagnostic.file.fileName));

    if (diagnostic.start !== undefined) {
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);

      line = position.line + 1;
      column = position.character + 1;
    }
  }

  return createProblem({
    code,
    source: "typescript",
    severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    file,
    line,
    column,
    rule: `TS${diagnostic.code}`,
  });
}

function collect(
  diagnostics: readonly ts.Diagnostic[],
  cwd: string,
  code: "WL7101" | "WL7102",
): ToolingProblem[] {
  return diagnostics
    .map((diagnostic) => diagnosticToProblem(diagnostic, cwd, code))
    .filter((problem): problem is ToolingProblem => problem !== undefined);
}

/**
 * The project files that import any of `targets` directly.
 *
 * Read from each file's import list (`ts.preProcessFile`) resolved with the
 * program's own options and a shared resolution cache, rather than through the
 * builder's transitive dependency graph: a change to a widely used file would
 * otherwise pull in nearly the whole project, and `--changed` exists to keep
 * the loop small. A full `warlock typecheck` (incremental, so cheap after the
 * first run) still checks everything.
 */
export function directImporters(
  program: ts.Program,
  targets: ReadonlySet<string>,
  root: string,
): Set<string> {
  const options = program.getCompilerOptions();
  const cache = ts.createModuleResolutionCache(root, (name) => name, options);
  const importers = new Set<string>();

  for (const sourceFile of program.getSourceFiles()) {
    const fileName = path.resolve(sourceFile.fileName);

    if (!isProjectFile(fileName, root, false) || targets.has(fileName)) continue;

    const { importedFiles } = ts.preProcessFile(sourceFile.text, true, true);

    for (const imported of importedFiles) {
      const resolved = ts.resolveModuleName(imported.fileName, fileName, options, ts.sys, cache)
        .resolvedModule?.resolvedFileName;

      if (resolved && targets.has(path.resolve(resolved))) {
        importers.add(fileName);
        break;
      }
    }
  }

  return importers;
}

/**
 * Typecheck the project with the TypeScript compiler API, incrementally.
 *
 * The program is built with `incremental` and `noEmit`, and its state is kept
 * in {@link DEFAULT_TYPECHECK_BUILD_INFO}, so a second run re-checks only what
 * changed. With `files`, diagnostics are collected only for those files and
 * their direct importers — the checker is lazy, so files nobody asks about are
 * parsed and bound but not checked, which is most of the memory a full check
 * costs.
 *
 * Never throws for a project problem: a missing or invalid tsconfig is a
 * `WL7102` problem, a type error a `WL7101` problem. A compiler crash is
 * re-thrown for the caller to classify (`warlock check` reports it as
 * `WL8007`).
 */
export function runTypecheck(options: TypecheckOptions = {}): TypecheckResult {
  const startedAt = Date.now();
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configPath = path.resolve(cwd, options.project ?? "tsconfig.json");
  const result = (
    problems: ToolingProblem[],
    rest: Partial<TypecheckResult> = {},
  ): TypecheckResult => ({
    ok: !problems.some((problem) => problem.severity === "error"),
    mode: options.files ? "files" : "program",
    files: null,
    checkedFiles: 0,
    problems,
    durationMs: Date.now() - startedAt,
    buildInfoFile: null,
    ...rest,
  });

  if (!existsSync(configPath)) {
    return result([
      createProblem({
        code: "WL7102",
        source: "typescript",
        message: `No TypeScript config at ${toPosix(path.relative(cwd, configPath)) || configPath}.`,
        file: toPosix(path.relative(cwd, configPath)),
      }),
    ]);
  }

  const read = ts.readConfigFile(configPath, ts.sys.readFile);

  if (read.error) {
    return result(collect([read.error], cwd, "WL7102"));
  }

  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );
  const buildInfoFile = path.resolve(cwd, options.buildInfoFile ?? DEFAULT_TYPECHECK_BUILD_INFO);

  mkdirSync(path.dirname(buildInfoFile), { recursive: true });

  const compilerOptions: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: true,
    incremental: true,
    tsBuildInfoFile: buildInfoFile,
    // Both require emitting and are refused alongside noEmit.
    composite: false,
    emitDeclarationOnly: false,
  };
  const builder = ts.createIncrementalProgram({
    rootNames: parsed.fileNames,
    options: compilerOptions,
    projectReferences: parsed.projectReferences,
    configFileParsingDiagnostics: ts.getConfigFileParsingDiagnostics(parsed),
    host: ts.createIncrementalCompilerHost(compilerOptions),
  });
  const problems: ToolingProblem[] = [
    ...collect(builder.getConfigFileParsingDiagnostics(), cwd, "WL7102"),
    ...collect(builder.getOptionsDiagnostics(), cwd, "WL7102"),
    ...collect(builder.getGlobalDiagnostics(), cwd, "WL7101"),
  ];

  let checked: ts.SourceFile[];
  let files: string[] | null = null;

  if (options.files) {
    const targets = new Set(options.files.map((file) => path.resolve(cwd, file)));
    const program = builder.getProgram();
    const wanted = new Set([...targets, ...directImporters(program, targets, cwd)]);

    checked = builder
      .getSourceFiles()
      .filter((sourceFile) => wanted.has(path.resolve(sourceFile.fileName)));
    files = checked.map((sourceFile) => toPosix(path.relative(cwd, sourceFile.fileName))).sort();
  } else {
    checked = builder
      .getSourceFiles()
      .filter((sourceFile) => isProjectFile(sourceFile.fileName, cwd));
  }

  for (const sourceFile of checked) {
    problems.push(
      ...collect(builder.getSyntacticDiagnostics(sourceFile), cwd, "WL7101"),
      ...collect(builder.getSemanticDiagnostics(sourceFile), cwd, "WL7101"),
    );
  }

  // With noEmit + incremental, emit writes only the .tsbuildinfo state.
  builder.emit();

  return result(problems, {
    files,
    checkedFiles: checked.length,
    buildInfoFile: existsSync(buildInfoFile) ? buildInfoFile : null,
  });
}
