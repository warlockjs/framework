import type { ToolConfig } from "@warlock.js/ai";
import type { CommandActionData } from "../../../commands/types";
import { withConsoleOnStderr } from "../routes/with-console-on-stderr";
import {
  isTool,
  loadMeasureModule,
  type AiCommandDependencies,
  type ModuleExports,
} from "./ai-command.action";

type ToolTarget = "openai-strict" | "anthropic" | "google";

const TARGETS: ReadonlyArray<ToolTarget> = ["openai-strict", "anthropic", "google"];

type DescribeModule = Pick<
  typeof import("@warlock.js/ai"),
  "describeToolSchemas" | "formatToolSchemaReports"
>;

function isDescribeModule(value: ModuleExports): value is ModuleExports & DescribeModule {
  return (
    typeof value.describeToolSchemas === "function" &&
    typeof value.formatToolSchemaReports === "function"
  );
}

function parseTargets(value: unknown): ToolTarget[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error("--targets requires a value.");

  const targets = value.split(",").map((entry) => entry.trim());
  const unknown = targets.filter((entry) => !TARGETS.includes(entry as ToolTarget));

  if (unknown.length > 0) {
    throw new Error(`Unknown --targets ${unknown.join(", ")}. Use ${TARGETS.join(", ")}.`);
  }

  return targets as ToolTarget[];
}

/**
 * `warlock ai tools --tools <module>`: lists the tools a module exports with
 * their estimated token cost per call and what each provider (OpenAI strict,
 * Anthropic, Google) would reject, ignore or over-charge for in their
 * schemas. `--json` prints the report; `--fail` exits 1 when a tool has an
 * error-level finding.
 */
export async function aiToolsAction(
  { options }: CommandActionData,
  dependencies: AiCommandDependencies = {},
): Promise<void> {
  const toolsModule = options.tools;

  if (typeof toolsModule !== "string" || !toolsModule.trim()) {
    throw new Error("Usage: warlock ai tools --tools <module> [--targets ...] [--json] [--fail]");
  }

  const warnAbove = options.warnAbove === undefined ? undefined : Number(options.warnAbove);

  if (warnAbove !== undefined && (!Number.isFinite(warnAbove) || warnAbove < 0)) {
    throw new Error("--warn-above requires a number of tokens.");
  }

  const targets = parseTargets(options.targets);
  const cwd = dependencies.cwd ?? process.cwd();
  const load = dependencies.load ?? ((specifier) => loadMeasureModule(specifier, cwd));

  const describe = async () => {
    let ai: ModuleExports;

    try {
      ai = await load("@warlock.js/ai");
    } catch (cause) {
      throw new Error(
        "Cannot load @warlock.js/ai. Install it in this project to use warlock ai tools.",
        { cause },
      );
    }

    if (!isDescribeModule(ai)) {
      throw new Error("warlock ai tools requires @warlock.js/ai 5.38.0 or newer.");
    }

    const exported = await load(toolsModule);
    const entries: unknown = exported.tools ?? exported.default;

    if (!Array.isArray(entries) || !entries.every(isTool)) {
      throw new Error("--tools must export an array of tool configs as tools or default.");
    }

    const summary = ai.describeToolSchemas(entries as ToolConfig<unknown, unknown>[], {
      ...(targets ? { targets } : {}),
      ...(warnAbove !== undefined ? { warnAboveTokens: warnAbove } : {}),
    });

    return { summary, text: ai.formatToolSchemaReports(summary.tools) };
  };

  const { summary, text } =
    options.json === true ? await withConsoleOnStderr(describe) : await describe();

  if (options.json === true) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(text || "No tools exported.");
    console.log(
      `${summary.tools.length} tools, ~${summary.tokens} tokens per call, ${summary.issueCount} findings.`,
    );
  }

  if (options.fail === true && summary.tools.some((report) => !report.ok)) {
    process.exitCode = 1;
  }
}
