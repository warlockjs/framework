import { log } from "@warlock.js/logger";
import { getAIConfig } from "../config";
import type { ToolConfig } from "../contracts/tool.contract";
import { isDevRuntime } from "../utils/dev-runtime";
import {
  describeToolSchema,
  type DescribeToolSchemaOptions,
  type ToolSchemaReport,
} from "./tool-schema-lint";

/** Definitions already reported, keyed by name and schema hash, so each warns once. */
const warned = new Set<string>();

/**
 * Check a tool definition when `ai.tool()` builds it and log one warning
 * listing what a provider would reject, ignore or charge for. Runs only in
 * development (not production, not under a test runner), once per tool
 * definition, and never throws.
 *
 * Turn it off for one tool with `lint: false`, for the app with
 * `ai.config({ toolLint: false })`.
 */
export function warnOnToolSchema(tool: ToolConfig<unknown, unknown>): ToolSchemaReport | undefined {
  if (tool.lint === false || !isDevRuntime()) return undefined;

  const configured = getAIConfig().toolLint;

  if (configured === false) return undefined;

  let report: ToolSchemaReport;

  try {
    const options: DescribeToolSchemaOptions = {
      ...(configured ?? {}),
      ...(typeof tool.lint === "object" ? tool.lint : {}),
    };

    report = describeToolSchema(tool, options);
  } catch {
    return undefined;
  }

  const key = `${report.name}:${report.schemaHash}`;
  const findings = report.issues.filter((issue) => issue.severity !== "info");

  if (findings.length === 0 || warned.has(key)) return report;

  warned.add(key);

  log.warn(
    "ai.tool",
    "schema.lint",
    `tool "${report.name}" (~${report.tokens} tokens per call) has ${findings.length} schema ${findings.length === 1 ? "finding" : "findings"}`,
    {
      tool: report.name,
      tokens: report.tokens,
      schemaHash: report.schemaHash,
      issues: findings.map(
        (issue) =>
          `${issue.severity} [${issue.targets.join(", ")}]${issue.path ? ` ${issue.path}` : ""}: ${issue.message}`,
      ),
    },
  );

  return report;
}

/** Forget which definitions already warned. For tests. */
export function resetToolLintWarnings(): void {
  warned.clear();
}
