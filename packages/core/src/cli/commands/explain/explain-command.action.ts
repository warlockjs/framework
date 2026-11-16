import { bootForInspect, inspectOptionsFromBoot } from "../../../tooling/inspect/boot-for-inspect";
import { inspectApp } from "../../../tooling/inspect/inspect-app";
import { explainFile, formatFileExplanation } from "../../../tooling/inspect/explain-file";
import { withConsoleOnStderr } from "../routes/with-console-on-stderr";
import { colors } from "@mongez/copper";
import { explainRegisteredCode, type ExplainableCode } from "../../../commands/explain-codes";
import { warlockConfigManager } from "../../../warlock-config/warlock-config.manager";
import type { CommandActionData } from "../../../commands/types";
import {
  ERROR_CODES,
  type ErrorCodeDefinition,
  errorCodeDocsUrl,
  explainErrorCode,
  isWarlockErrorCode,
} from "../../../errors/error-codes";

/** What `warlock explain <code> --json` prints: the registry entry plus its docs URL. */
export type ExplainedErrorCode = ErrorCodeDefinition & { docs: string };

function withDocs(definition: ErrorCodeDefinition): ExplainedErrorCode {
  return {
    ...definition,
    docs: isWarlockErrorCode(definition.code) ? errorCodeDocsUrl(definition.code) : "",
  };
}

/**
 * The lines `warlock explain <code>` prints, uncolored, so they are testable.
 *
 * @param definition The registry entry to describe.
 */
export function formatExplanation(definition: ErrorCodeDefinition): string[] {
  const { docs } = withDocs(definition);

  return [
    `${definition.code}  ${definition.title}`,
    "",
    `  Area:     ${definition.area} (${definition.category === "environment" ? "this machine" : "your code"})`,
    `  Fix:      ${definition.fix}`,
    `  Skill:    ${definition.skill}`,
    `  Docs:     ${docs}`,
    ...(definition.errorNames?.length ? [`  Thrown as: ${definition.errorNames.join(", ")}`] : []),
  ];
}

/**
 * The lines `warlock explain <code>` prints for a code a package explains,
 * uncolored, so they are testable.
 *
 * @param code The package's answer.
 */
export function formatRegisteredExplanation(code: ExplainableCode): string[] {
  return [
    `${code.code}  ${code.title}`,
    "",
    `  Area:     ${code.area}`,
    `  Fix:      ${code.fix}`,
    `  Skill:    ${code.skill}`,
    `  Docs:     ${code.docs}`,
  ];
}

/** Ask the explainers of the commands in `cli.commands`; never boots the app. */
async function explainPackageCode(requested: string, json: boolean): Promise<void> {
  let answer: ExplainableCode | undefined;

  try {
    if (!warlockConfigManager.isLoaded) await warlockConfigManager.load();

    answer = explainRegisteredCode(warlockConfigManager.get("cli")?.commands, requested);
  } catch {
    answer = undefined;
  }

  if (!answer) {
    throw new Error(
      `Unknown error code ${JSON.stringify(requested)}. No installed package explains it: register the package's commands in cli.commands of warlock.config.ts, or run \`warlock explain\` to list the Warlock codes.`,
    );
  }

  if (json) {
    console.log(JSON.stringify(answer, null, 2));
    return;
  }

  const [heading, ...rest] = formatRegisteredExplanation(answer);

  console.log(colors.bold(heading ?? answer.code));

  for (const line of rest) console.log(line);
}

/** One line per registered code, for `warlock explain` without an argument. */
export function formatCodeList(): string[] {
  return Object.values(ERROR_CODES).map(
    (definition: ErrorCodeDefinition) => `${definition.code}  ${definition.title}`,
  );
}

/**
 * Action behind `warlock explain [code]`.
 *
 * With a code, prints what it means and what to do; with `--json`, the registry
 * entry as JSON. Without a code, lists every code (or, with `--json`, every
 * entry). An unknown code is thrown, so the CLI exits 1.
 *
 * @param data Parsed CLI args: the code as the first positional, `options.json`.
 */
export async function explainCommandAction({ args, options }: CommandActionData): Promise<void> {
  const requested = args[0];

  if (requested === undefined || requested.trim() === "") {
    if (options.json) {
      console.log(JSON.stringify(Object.values(ERROR_CODES).map(withDocs), null, 2));
      return;
    }

    for (const line of formatCodeList()) {
      console.log(line);
    }

    return;
  }

  if (!/^WL\d+$/i.test(requested.trim()) && /^[A-Z]{2}\d{4}$/i.test(requested.trim())) {
    await explainPackageCode(requested.trim(), Boolean(options.json));
    return;
  }

  if (!/^WL\d+$/i.test(requested.trim())) {
    const collect = async () => {
      const boot = await bootForInspect();
      return explainFile(
        requested,
        await inspectApp({
          ...inspectOptionsFromBoot(boot),
          sections: ["files", "routes", "pages"],
        }),
      );
    };
    const file = await withConsoleOnStderr(collect);
    if (options.json) console.log(JSON.stringify(file, null, 2));
    else for (const line of formatFileExplanation(file)) console.log(line);
    return;
  }

  const definition = explainErrorCode(requested);

  if (!definition) {
    // Thrown, not printed: the CLI reports it on stderr and exits 1.
    throw new Error(
      `Unknown error code ${JSON.stringify(requested)}. Run \`warlock explain\` to list every code.`,
    );
  }

  if (options.json) {
    console.log(JSON.stringify(withDocs(definition), null, 2));
    return;
  }

  const [heading, ...rest] = formatExplanation(definition);

  console.log(colors.bold(heading ?? definition.code));

  for (const line of rest) {
    console.log(line);
  }
}
