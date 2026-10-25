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

/** Apply `fixes` to `source`, last offset first so earlier offsets stay valid. */
export function applyFixes(source: string, fixes: readonly ProblemFix[]): string {
  let result = source;
  let appliedFrom = Infinity;

  for (const fix of [...fixes].sort((a, b) => b.start - a.start || b.end - a.end)) {
    // An overlapping fix would corrupt the text; the next run picks it up.
    if (fix.end > appliedFrom) continue;

    result = result.slice(0, fix.start) + fix.text + result.slice(fix.end);
    appliedFrom = fix.start;
  }

  return result;
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
    writeFileSync(target, applyFixes(readFileSync(target, "utf8"), fixes));
  }
}
