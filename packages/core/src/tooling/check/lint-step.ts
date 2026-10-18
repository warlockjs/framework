import { ESLint } from "eslint";
import path from "node:path";
import { hasEslint, warnEslintDeprecation } from "../../dev-server/health-checker/eslint-support";
import {
  findOxlint,
  hasOxlintConfig,
  OxlintRunner,
} from "../../dev-server/health-checker/oxlint-runner";
import { createProblem, type ToolingProblem } from "../problem";

/** What the lint step found, and which linters ran. */
export type LintOutcome = {
  problems: ToolingProblem[];
  /** The linters that ran (`eslint`, `oxlint`); empty when the app configures none. */
  linters: string[];
};

const LINTABLE = /\.[cm]?[jt]sx?$/i;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A missing package/plugin is the machine's install; anything else is the tool crashing. */
function toolFailure(tool: string, error: unknown): ToolingProblem {
  const message = errorMessage(error);
  const missing = /cannot find (?:module|package)|ERR_MODULE_NOT_FOUND/i.test(message);

  return createProblem({
    code: missing ? "WL8002" : "WL8007",
    source: "environment",
    message: `${tool} could not run: ${message.split("\n")[0]}`,
  });
}

async function runEslint(cwd: string, files: readonly string[]): Promise<ToolingProblem[]> {
  // The same flat-config lookup the dev server's ESLint checker uses.
  const eslint = new ESLint({ cwd, errorOnUnmatchedPattern: false, warnIgnored: false });
  const results = await eslint.lintFiles([...files]);
  const problems: ToolingProblem[] = [];

  for (const result of results) {
    const file = path.relative(cwd, result.filePath).split(path.sep).join("/");

    for (const message of result.messages) {
      const error = message.severity === 2 || message.fatal === true;

      problems.push(
        createProblem({
          code: error ? "WL7201" : "WL7202",
          source: "eslint",
          severity: error ? "error" : "warning",
          message: message.message,
          file,
          line: message.line || null,
          column: message.column || null,
          rule: message.ruleId ?? null,
        }),
      );
    }
  }

  return problems;
}

async function runOxlint(cwd: string, files: readonly string[]): Promise<ToolingProblem[]> {
  const runner = new OxlintRunner();

  runner.initialize(cwd);

  try {
    const results = await runner.checkFiles(
      files.map((file) => ({ path: path.join(cwd, file), relativePath: file })),
    );

    return results.flatMap((result) =>
      [...result.errors, ...result.warnings].map((message) =>
        createProblem({
          code: message.type === "error" ? "WL7201" : "WL7202",
          source: "oxlint",
          severity: message.type,
          message: message.message,
          file: message.relativePath,
          line: message.lineNumber,
          column: message.columnNumber,
          rule: message.ruleId ?? null,
        }),
      ),
    );
  } finally {
    await runner.shutdown();
  }
}

/** Oxlint by default. ESLint requires an explicit selection and a flat config. */
export async function runLint(
  cwd: string,
  files: readonly string[],
  selection: "oxlint" | "eslint" = "oxlint",
): Promise<LintOutcome> {
  const lintable = files.filter((file) => LINTABLE.test(file));
  const problems: ToolingProblem[] = [];
  const linters: string[] = [];

  // ESLint lints the whole directory when handed no pattern; nothing to lint
  // means nothing to run.
  if (lintable.length === 0) return { problems, linters };

  if (selection === "eslint") {
    warnEslintDeprecation();
    if (!hasEslint(cwd)) {
      return {
        linters: ["eslint"],
        problems: [
          createProblem({
            code: "WL8002",
            source: "environment",
            message: "Cannot find ESLint flat config in the app.",
          }),
        ],
      };
    }
    linters.push("eslint");

    try {
      problems.push(...(await runEslint(cwd, lintable)));
    } catch (error) {
      problems.push(toolFailure("ESLint", error));
    }
  }

  if (selection === "oxlint" && hasOxlintConfig(cwd)) {
    linters.push("oxlint");

    if (!findOxlint(cwd)) {
      problems.push(
        createProblem({
          code: "WL8002",
          source: "environment",
          message: "An oxlint config exists but the oxlint package is not installed in the app.",
        }),
      );
    } else {
      try {
        problems.push(...(await runOxlint(cwd, lintable)));
      } catch (error) {
        problems.push(toolFailure("oxlint", error));
      }
    }
  }

  return { problems, linters };
}
