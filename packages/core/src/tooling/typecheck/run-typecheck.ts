import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createProblem, type ToolingProblem } from "../problem";
import {
  CompilerSession,
  nativePath,
  runCompiler,
  type CompilerDiagnostic,
} from "../typescript/compiler";

export type TypecheckOptions = {
  cwd?: string;
  project?: string;
  files?: readonly string[];
  buildInfoFile?: string;
};
export type TypecheckResult = {
  ok: boolean;
  mode: "program" | "files";
  files: string[] | null;
  checkedFiles: number;
  problems: ToolingProblem[];
  durationMs: number;
  buildInfoFile: string | null;
};
export const DEFAULT_TYPECHECK_BUILD_INFO = path.join(".warlock", "cache", "typecheck.tsbuildinfo");
const toPosix = (file: string) => file.split(path.sep).join("/");
function isProjectFile(file: string, root: string, declarations = true): boolean {
  return (
    file.startsWith(root + path.sep) &&
    !file.split(path.sep).includes("node_modules") &&
    (declarations || !file.endsWith(".d.ts"))
  );
}
export function diagnosticToProblem(
  diagnostic: CompilerDiagnostic,
  cwd: string,
  code: "WL7101" | "WL7102" = "WL7101",
): ToolingProblem {
  return createProblem({
    code,
    source: "typescript",
    severity: diagnostic.severity,
    message: diagnostic.message,
    file: diagnostic.fileName ? toPosix(path.relative(cwd, diagnostic.fileName)) : null,
    line: diagnostic.fileName ? diagnostic.line : null,
    column: diagnostic.fileName ? diagnostic.column : null,
    rule: `TS${diagnostic.code}`,
  });
}

/** Resolve direct importers with the native checker, including package exports and aliases. */
export function directImporters(
  session: CompilerSession,
  targets: ReadonlySet<string>,
  root: string,
): Set<string> {
  const importers = new Set<string>();
  for (const file of session.fileNames) {
    if (!isProjectFile(file, root, false) || targets.has(file)) continue;
    if (session.importFiles(file).some((imported) => targets.has(path.resolve(imported))))
      importers.add(file);
  }
  return importers;
}

/** TypeScript 7's native incremental compiler owns build state; changed mode filters its diagnostics. */
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
  if (!existsSync(configPath))
    return result([
      createProblem({
        code: "WL7102",
        source: "typescript",
        message: `No TypeScript config at ${toPosix(path.relative(cwd, configPath)) || configPath}.`,
        file: toPosix(path.relative(cwd, configPath)),
      }),
    ]);
  const buildInfoFile = path.resolve(cwd, options.buildInfoFile ?? DEFAULT_TYPECHECK_BUILD_INFO);
  mkdirSync(path.dirname(buildInfoFile), { recursive: true });
  const compiled = runCompiler(cwd, [
    "-p",
    configPath,
    "--noEmit",
    "--incremental",
    "--tsBuildInfoFile",
    buildInfoFile,
    "--composite",
    "false",
    "--emitDeclarationOnly",
    "false",
    "--listFiles",
  ]);
  const sources = compiled.output
    .split(/\r?\n/)
    .map((line) => (path.isAbsolute(line) ? nativePath(line) : ""))
    .filter((file) => isProjectFile(file, cwd));
  const wanted = options.files
    ? new Set(options.files.map((file) => path.resolve(cwd, file)))
    : null;
  if (wanted) {
    const session = new CompilerSession(cwd, configPath);
    try {
      for (;;) {
        const importers = directImporters(session, wanted, cwd);
        if (!importers.size) break;
        for (const file of importers) wanted.add(file);
      }
    } finally {
      session.close();
    }
  }
  const checked = sources.filter((file) => !wanted || wanted.has(file));
  const configCodes = new Set([18002, 18003]);
  const problems = [...compiled.diagnostics]
    .sort((a, b) => Number(b.fileName === configPath) - Number(a.fileName === configPath))
    .filter(
      (diagnostic) =>
        !diagnostic.fileName ||
        diagnostic.fileName === configPath ||
        (isProjectFile(diagnostic.fileName, cwd) && (!wanted || wanted.has(diagnostic.fileName))),
    )
    .map((diagnostic) =>
      diagnosticToProblem(
        diagnostic,
        cwd,
        !diagnostic.fileName ||
          diagnostic.fileName === configPath ||
          configCodes.has(diagnostic.code)
          ? "WL7102"
          : "WL7101",
      ),
    );
  return result(problems, {
    files: wanted ? checked.map((file) => toPosix(path.relative(cwd, file))).sort() : null,
    checkedFiles: checked.length,
    buildInfoFile: existsSync(buildInfoFile) ? buildInfoFile : null,
  });
}
