import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ToolingProblem } from "../problem";
import { importSpecifiers } from "../syntax/imports";

export type ProblemFix = { start: number; end: number; text: string };

/** Only relative .js imports: removing the suffix preserves TypeScript resolution. */
export function importFixes(file: string, source: string): ProblemFix[] {
  return importSpecifiers(file, source)
    .filter(
      ({ specifier, node }) =>
        specifier.startsWith(".") &&
        specifier.endsWith(".js") &&
        /\.js['"]$/.test(source.slice(node.start, node.end)),
    )
    .map(({ node }) => ({ start: node.end - 4, end: node.end - 1, text: "" }));
}

export function applyConventionFixes(cwd: string, problems: readonly ToolingProblem[]): void {
  const files = new Map<string, ProblemFix[]>();
  for (const problem of problems)
    if (problem.file && problem.fix) {
      const fixes = files.get(problem.file) ?? [];
      fixes.push(problem.fix);
      files.set(problem.file, fixes);
    }
  for (const [file, fixes] of files) {
    const target = path.join(cwd, file);
    let source = readFileSync(target, "utf8");
    for (const fix of [...fixes].sort((a, b) => b.start - a.start))
      source = source.slice(0, fix.start) + fix.text + source.slice(fix.end);
    writeFileSync(target, source);
  }
}
