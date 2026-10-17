import {
  ERROR_CODES,
  errorCodeDocsUrl,
  type ErrorCodeCategory,
  type WarlockErrorCode,
} from "../errors/error-codes";

/** The tool that found a problem. */
export type ProblemSource =
  | "typescript"
  | "eslint"
  | "oxlint"
  | "vitest"
  | "convention"
  | "environment"
  | "doctor";

/**
 * One problem, in the shape every machine-readable command prints
 * (`warlock check --json`, `warlock typecheck --json`, `warlock doctor --json`).
 *
 * Every key is always present, so a consumer never has to test for one:
 * `file`, `line` and `column` are `null` when the problem has no position.
 */
export type ToolingProblem = {
  /** Stable Warlock error code; `warlock explain <code>` prints the fix. */
  code: WarlockErrorCode;
  /** `code` = fix the project; `environment` = fix this machine. */
  category: ErrorCodeCategory;
  /** `error` fails the run; `warning` is reported and does not. */
  severity: "error" | "warning";
  /** The tool that reported it. */
  source: ProblemSource;
  /** Project-relative POSIX path, or `null`. */
  file: string | null;
  /** 1-based line, or `null`. */
  line: number | null;
  /** 1-based column, or `null`. */
  column: number | null;
  /** What is wrong, in the reporting tool's words. */
  message: string;
  /** One line on what to do, from the code registry. */
  hint: string;
  /** Slug of the skill that explains the fix. */
  skill: string;
  /** Docs URL of the code. */
  docs: string;
  /** The tool's own rule or code (`TS2345`, `no-unused-vars`, a test name), or `null`. */
  rule: string | null;
};

/** The fields a reporter supplies; the rest come from the registry. */
export type ProblemInput = {
  code: WarlockErrorCode;
  source: ProblemSource;
  message: string;
  severity?: "error" | "warning";
  file?: string | null;
  line?: number | null;
  column?: number | null;
  rule?: string | null;
};

/**
 * Build a {@link ToolingProblem}, filling `category`, `hint`, `skill` and `docs`
 * from the code registry so every reporter describes a code the same way.
 */
export function createProblem(input: ProblemInput): ToolingProblem {
  const definition = ERROR_CODES[input.code];

  return {
    code: input.code,
    category: definition.category,
    severity: input.severity ?? "error",
    source: input.source,
    file: input.file ?? null,
    line: input.line ?? null,
    column: input.column ?? null,
    message: input.message,
    hint: definition.fix,
    skill: definition.skill,
    docs: errorCodeDocsUrl(input.code),
    rule: input.rule ?? null,
  };
}
