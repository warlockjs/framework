import path from "node:path";
import {
  findOxlint,
  hasOxlintConfig,
  OxlintRunner,
} from "../../dev-server/health-checker/oxlint-runner";
import { createProblem, type ToolingProblem } from "../problem";

/** What the lint step found, and which linters ran. */
export type LintOutcome = {
  problems: ToolingProblem[];
  /** The linters that ran (`oxlint`); empty when the app configures none. */
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

/** Run configured Oxlint over lintable source files. */
export async function runLint(cwd: string, files: readonly string[]): Promise<LintOutcome> {
  const lintable = files.filter((file) => LINTABLE.test(file));
  const problems: ToolingProblem[] = [];
  const linters: string[] = [];

  if (lintable.length === 0) return { problems, linters };

  if (hasOxlintConfig(cwd)) {
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
