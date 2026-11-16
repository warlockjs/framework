/**
 * Error codes a package explains through `warlock explain <code>`.
 *
 * Kept free of runtime imports: a package's `register…Commands()` calls
 * {@link withExplainCodes}, and `warlock.config.ts` reaches the production
 * entry, so this file must not pull the tooling in with it.
 */
import type { CLICommand, CLICommandEntry } from "./cli-command";

/** What a package's explainer returns for one of its codes. Same fields `warlock explain WLxxxx` prints. */
export type ExplainableCode = {
  code: string;
  title: string;
  /** Area name (`links`, `book`…). */
  area: string;
  fix: string;
  /** Skill slug that explains the fix. */
  skill: string;
  /** Docs URL of the code. */
  docs: string;
};

/** Answers one code, or `undefined` when the code is not this package's. */
export type CodeExplainer = (code: string) => ExplainableCode | undefined;

/**
 * Shared through the global symbol registry, so a command built against
 * another copy of `@warlock.js/core` still carries its explainers.
 */
const EXPLAIN_CODES = Symbol.for("warlock.explain.codes");

/**
 * Let `warlock explain <code>` answer the codes of a package. When the command
 * is listed in `cli.commands` of `warlock.config.ts`, the explainer is asked
 * for a code of two letters and four digits that is not a Warlock `WL` code
 * (`GR2001`, upper-cased before it is asked). Returns the same command, so a
 * package's register function stays one expression. Calling it again adds
 * more explainers.
 *
 * @example
 * export function registerReportCommands() {
 *   return withExplainCodes(command({ name: "report", action: runReport }), (code) =>
 *     code === "RP1001"
 *       ? {
 *           code,
 *           title: "Report is empty",
 *           area: "report",
 *           fix: "Run the report with a wider date range.",
 *           skill: "reports",
 *           docs: "https://example.com/docs/RP1001",
 *         }
 *       : undefined,
 *   );
 * }
 */
export function withExplainCodes<Command extends CLICommand>(
  command: Command,
  explain: CodeExplainer,
): Command {
  const attached = explainersOf(command);

  Object.defineProperty(command, EXPLAIN_CODES, {
    value: [...attached, explain],
    enumerable: false,
    configurable: true,
  });

  return command;
}

/** The explainers {@link withExplainCodes} attached to a command (empty when none). */
export function explainersOf(command: unknown): CodeExplainer[] {
  if (typeof command !== "object" || command === null) return [];

  const explainers: unknown = Reflect.get(command, EXPLAIN_CODES);

  return Array.isArray(explainers) ? [...(explainers as CodeExplainer[])] : [];
}

/**
 * Ask every explainer attached to the given `cli.commands` entries (nested
 * arrays allowed). The first answer wins.
 *
 * @example
 * const answer = explainRegisteredCode(config.cli?.commands, "RP1001");
 */
export function explainRegisteredCode(
  entries: readonly CLICommandEntry[] | undefined,
  code: string,
): ExplainableCode | undefined {
  for (const entry of entries ?? []) {
    const commands: readonly unknown[] = Array.isArray(entry) ? entry : [entry];

    for (const command of commands) {
      for (const explain of explainersOf(command)) {
        const answer = explain(code);

        if (answer) return answer;
      }
    }
  }

  return undefined;
}
