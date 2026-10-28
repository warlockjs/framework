import type { ToolConfig } from "../contracts/tool.contract";
import { estimateInputTokens } from "../utils/estimate-input-tokens";
import { hashText, stableJson } from "../utils/hash-text";
import { extractJsonSchema } from "../utils/json-schema";

/**
 * Provider targets a tool definition is checked against.
 *
 * - `"openai-strict"` — OpenAI function calling with `strict: true`
 *   (every property listed in `required`, `additionalProperties: false`,
 *   a restricted keyword set).
 * - `"anthropic"` — Anthropic `input_schema` (object root).
 * - `"google"` — Gemini `parametersJsonSchema` (object root, a subset of
 *   JSON Schema keywords).
 */
export type ToolSchemaTarget = "openai-strict" | "anthropic" | "google";

/** Every target, in the order reports list them. */
export const TOOL_SCHEMA_TARGETS: ReadonlyArray<ToolSchemaTarget> = [
  "openai-strict",
  "anthropic",
  "google",
];

/** `"error"` — the provider rejects or drops the tool; `"warning"` — it works but not as written. */
/** `info` findings are reported by `describeToolSchema` but never warned about at definition time. */
export type ToolSchemaSeverity = "error" | "warning" | "info";

/** Stable code of one finding, for filtering and tests. */
export type ToolSchemaIssueCode =
  /** The input schema is not an object schema; the adapters send an empty parameter list instead. */
  | "root-not-object"
  /** A field declared optional is sent as required (nullable), so the model always has to fill it. */
  | "optional-forced-required"
  /** A property is missing from `required`; OpenAI strict mode rejects the tool. */
  | "optional-not-required"
  /** An object schema does not set `additionalProperties: false`; OpenAI strict mode rejects it. */
  | "missing-additional-properties-false"
  /** A keyword the provider rejects or ignores. */
  | "unsupported-keyword"
  /** A tool or property description longer than the recommended size. */
  | "oversized-description"
  /** The tool name uses characters or a length the provider rejects. */
  | "invalid-name"
  /** The tool definition costs more tokens than the budget on every call. */
  | "heavy-definition";

/** One finding of {@link describeToolSchema}. */
export type ToolSchemaIssue = {
  code: ToolSchemaIssueCode;
  severity: ToolSchemaSeverity;
  /** The targets this finding applies to. */
  targets: ToolSchemaTarget[];
  /** Where in the schema: `""` for the tool itself, `"properties.city"` and so on. */
  path: string;
  message: string;
};

/** Tuning for {@link describeToolSchema}. */
export type DescribeToolSchemaOptions = {
  /** Targets to check. Default: all three. */
  targets?: ReadonlyArray<ToolSchemaTarget>;
  /** Longest tool description before a warning. Default `1024` characters. */
  maxDescriptionChars?: number;
  /** Longest property description before a warning. Default `512` characters. */
  maxPropertyDescriptionChars?: number;
  /** Token estimate above which a definition is flagged as heavy. Default `500`. */
  warnAboveTokens?: number;
  /** Characters per token for the estimate. Default `4`, see `estimateInputTokens`. */
  charsPerToken?: number;
  /**
   * Finding codes to drop from the report, for a schema the app deliberately
   * sends as is (a remote MCP tool, say). The dropped findings are not
   * counted and never warn.
   */
  ignore?: ReadonlyArray<ToolSchemaIssueCode>;
};

/** The result of {@link describeToolSchema}. */
export type ToolSchemaReport = {
  /** The tool's name. */
  name: string;
  /**
   * Estimated input tokens this definition adds to every call that offers
   * it (name, description and JSON Schema at `charsPerToken` characters
   * per token). An estimate, not a tokenizer count; `ai.tools.measure`
   * with a model that can count natively is exact.
   */
  tokens: number;
  /** Characters in the tool description. */
  descriptionChars: number;
  /** Short hash of the name, description and schema as sent; changes when any of them does. */
  schemaHash: string;
  /** The targets that were checked. */
  targets: ToolSchemaTarget[];
  /** Findings, errors first. */
  issues: ToolSchemaIssue[];
  /** `false` when any finding is an `"error"`. */
  ok: boolean;
};

/** The result of {@link describeToolSchemas}: one report per tool plus totals. */
export type ToolSchemaSummary = {
  tools: ToolSchemaReport[];
  /** Estimated tokens for the whole list. */
  tokens: number;
  /** Number of findings across all tools. */
  issueCount: number;
};

const DEFAULT_MAX_DESCRIPTION_CHARS = 1024;
const DEFAULT_MAX_PROPERTY_DESCRIPTION_CHARS = 512;
const DEFAULT_WARN_ABOVE_TOKENS = 500;

/** `^[a-zA-Z0-9_-]{1,64}$`: the OpenAI and Anthropic function name rule. */
const NAME_PATTERNS: Record<ToolSchemaTarget, RegExp> = {
  "openai-strict": /^[a-zA-Z0-9_-]{1,64}$/,
  anthropic: /^[a-zA-Z0-9_-]{1,64}$/,
  google: /^[a-zA-Z_][a-zA-Z0-9_.:-]{0,63}$/,
};

const NAME_RULES: Record<ToolSchemaTarget, string> = {
  "openai-strict": "use letters, digits, underscores and dashes, at most 64 characters",
  anthropic: "use letters, digits, underscores and dashes, at most 64 characters",
  google:
    "start with a letter or underscore, then letters, digits, underscores, dots, colons or dashes, at most 64 characters",
};

/**
 * Keywords each provider rejects or silently ignores in a function schema.
 * OpenAI strict mode documents its supported subset (no `allOf`, `not`,
 * conditionals, dependent keywords or `oneOf`; use `anyOf`). Gemini's
 * `parametersJsonSchema` ignores or rejects composition and conditional
 * keywords. Anthropic accepts the schema as written, so it has none.
 */
const UNSUPPORTED_KEYWORDS: Record<ToolSchemaTarget, ReadonlySet<string>> = {
  "openai-strict": new Set([
    "allOf",
    "oneOf",
    "not",
    "if",
    "then",
    "else",
    "dependentRequired",
    "dependentSchemas",
    "patternProperties",
    "propertyNames",
    "unevaluatedProperties",
  ]),
  anthropic: new Set(),
  google: new Set([
    "allOf",
    "not",
    "if",
    "then",
    "else",
    "dependentRequired",
    "dependentSchemas",
    "patternProperties",
    "propertyNames",
    "unevaluatedProperties",
  ]),
};

type SchemaNode = Record<string, unknown>;

function isNode(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinPath(base: string, segment: string): string {
  return base ? `${base}.${segment}` : segment;
}

/** Calls `visit` for every schema node under `node`, with its path. */
function walkSchema(node: unknown, path: string, visit: (node: SchemaNode, path: string) => void) {
  if (!isNode(node)) return;

  visit(node, path);

  if (isNode(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) {
      walkSchema(child, joinPath(path, `properties.${key}`), visit);
    }
  }

  if (Array.isArray(node.items)) {
    node.items.forEach((child, index) =>
      walkSchema(child, joinPath(path, `items.${index}`), visit),
    );
  } else {
    walkSchema(node.items, joinPath(path, "items"), visit);
  }

  if (isNode(node.additionalProperties)) {
    walkSchema(node.additionalProperties, joinPath(path, "additionalProperties"), visit);
  }

  for (const branch of ["anyOf", "oneOf", "allOf"] as const) {
    const value = node[branch];

    if (Array.isArray(value)) {
      value.forEach((child, index) =>
        walkSchema(child, joinPath(path, `${branch}.${index}`), visit),
      );
    }
  }

  for (const defs of ["$defs", "definitions"] as const) {
    const value = node[defs];

    if (isNode(value)) {
      for (const [key, child] of Object.entries(value)) {
        walkSchema(child, joinPath(path, `${defs}.${key}`), visit);
      }
    }
  }
}

function requiredOf(node: SchemaNode): string[] {
  return Array.isArray(node.required)
    ? node.required.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Collects issues keyed by code, path and message so one finding lists all its targets. */
class IssueCollector {
  private readonly byKey = new Map<string, ToolSchemaIssue>();

  add(issue: Omit<ToolSchemaIssue, "targets">, target: ToolSchemaTarget): void {
    const key = `${issue.code}|${issue.path}|${issue.message}`;
    const existing = this.byKey.get(key);

    if (existing) {
      if (!existing.targets.includes(target)) existing.targets.push(target);
      return;
    }

    this.byKey.set(key, { ...issue, targets: [target] });
  }

  list(): ToolSchemaIssue[] {
    return [...this.byKey.values()].sort(
      (left, right) => Number(right.severity === "error") - Number(left.severity === "error"),
    );
  }
}

function safeExtract(
  tool: Pick<ToolConfig<unknown, unknown>, "input">,
  target?: string,
): SchemaNode | undefined {
  try {
    return extractJsonSchema(tool.input, target ? { target } : {});
  } catch {
    return undefined;
  }
}

/**
 * Check one tool definition against the providers it may be sent to and
 * estimate its token cost. Pure and synchronous; never throws.
 *
 * The schema checked is the one the provider adapters send: the shared
 * `extractJsonSchema` output (Seal's `openai-strict` target by default).
 * Findings:
 *
 * - `optional-forced-required` — a field the schema author declared
 *   optional is sent as required and nullable, so the model must always
 *   fill it (compared with the `draft-2020-12` extraction).
 * - `optional-not-required` / `missing-additional-properties-false` —
 *   what OpenAI strict mode rejects.
 * - `unsupported-keyword` — keywords a provider rejects or ignores.
 * - `oversized-description`, `invalid-name`, `root-not-object`,
 *   `heavy-definition`.
 *
 * Also available as `ai.tools.describe(tool)`.
 *
 * @example
 * const report = describeToolSchema(saveFacts);
 * console.log(report.tokens, report.issues.map((issue) => issue.message));
 */
export function describeToolSchema(
  tool: Pick<ToolConfig<unknown, unknown>, "name" | "description" | "input">,
  options: DescribeToolSchemaOptions = {},
): ToolSchemaReport {
  const targets = [...(options.targets ?? TOOL_SCHEMA_TARGETS)];
  const maxDescription = options.maxDescriptionChars ?? DEFAULT_MAX_DESCRIPTION_CHARS;
  const maxPropertyDescription =
    options.maxPropertyDescriptionChars ?? DEFAULT_MAX_PROPERTY_DESCRIPTION_CHARS;
  const warnAboveTokens = options.warnAboveTokens ?? DEFAULT_WARN_ABOVE_TOKENS;
  const issues = new IssueCollector();
  const sent = safeExtract(tool);
  const declared = safeExtract(tool, "draft-2020-12");
  const description = typeof tool.description === "string" ? tool.description : "";

  const tokens = estimateInputTokens([], {
    tools: [tool as ToolConfig<unknown, unknown>],
    ...(options.charsPerToken !== undefined ? { charsPerToken: options.charsPerToken } : {}),
    perMessageTokens: 0,
  });

  for (const target of targets) {
    if (!NAME_PATTERNS[target].test(tool.name)) {
      issues.add(
        {
          code: "invalid-name",
          severity: "error",
          path: "",
          message: `Tool name "${tool.name}" is not accepted: ${NAME_RULES[target]}.`,
        },
        target,
      );
    }

    if (description.length > maxDescription) {
      issues.add(
        {
          code: "oversized-description",
          severity: "warning",
          path: "",
          message: `The tool description is ${description.length} characters (recommended at most ${maxDescription}); it is sent on every call.`,
        },
        target,
      );
    }

    if (tool.input && sent && sent.type !== "object") {
      issues.add(
        {
          code: "root-not-object",
          severity: "error",
          path: "",
          message:
            "The input schema is not an object schema, so the provider adapters send the tool with no parameters. Wrap the input in an object.",
        },
        target,
      );
    }

    if (!sent) continue;

    const unsupported = UNSUPPORTED_KEYWORDS[target];
    const declaredNodes = new Map<string, SchemaNode>();

    if (declared) walkSchema(declared, "", (node, path) => declaredNodes.set(path, node));

    walkSchema(sent, "", (node, path) => {
      for (const keyword of Object.keys(node)) {
        if (unsupported.has(keyword)) {
          issues.add(
            {
              code: "unsupported-keyword",
              severity: "warning",
              path,
              message: `Keyword "${keyword}" is rejected or ignored by the provider${keyword === "oneOf" ? "; use anyOf" : ""}.`,
            },
            target,
          );
        }
      }

      if (
        typeof node.description === "string" &&
        node.description.length > maxPropertyDescription
      ) {
        issues.add(
          {
            code: "oversized-description",
            severity: "warning",
            path,
            message: `The description at "${path || "root"}" is ${node.description.length} characters (recommended at most ${maxPropertyDescription}).`,
          },
          target,
        );
      }

      if (node.type !== "object" || !isNode(node.properties)) return;

      const required = requiredOf(node);
      const declaredRequired = requiredOf(declaredNodes.get(path) ?? {});
      const comparable = declaredNodes.has(path) && declaredNodes.get(path) !== node;

      for (const key of Object.keys(node.properties)) {
        if (required.includes(key)) {
          if (comparable && !declaredRequired.includes(key)) {
            issues.add(
              {
                code: "optional-forced-required",
                // Strict providers require every key; sending an optional field as
                // required-and-nullable is the intended mapping, so this is a note.
                severity: "info",
                path: joinPath(path, `properties.${key}`),
                message: `"${key}" is optional in the schema but is sent as required and nullable, so the model must always fill it (with null when it has nothing). Make it required on purpose or split the tool.`,
              },
              target,
            );
          }
        } else if (target === "openai-strict") {
          issues.add(
            {
              code: "optional-not-required",
              severity: "error",
              path: joinPath(path, `properties.${key}`),
              message: `"${key}" is not in "required"; OpenAI strict mode needs every property required (express optional as nullable).`,
            },
            target,
          );
        }
      }

      if (target === "openai-strict" && node.additionalProperties !== false) {
        issues.add(
          {
            code: "missing-additional-properties-false",
            severity: "error",
            path,
            message: `The object at "${path || "root"}" must set additionalProperties to false for OpenAI strict mode.`,
          },
          target,
        );
      }
    });
  }

  if (tokens > warnAboveTokens) {
    for (const target of targets) {
      issues.add(
        {
          code: "heavy-definition",
          severity: "warning",
          path: "",
          message: `Estimated ${tokens} tokens per call (budget ${warnAboveTokens}). Shorten descriptions, drop unused fields or use toolSchemas: "compact".`,
        },
        target,
      );
    }
  }

  const ignored = options.ignore;
  const list = ignored?.length
    ? issues.list().filter((issue) => !ignored.includes(issue.code))
    : issues.list();

  return {
    name: tool.name,
    tokens,
    descriptionChars: description.length,
    schemaHash: hashText(stableJson({ name: tool.name, description, parameters: sent ?? null })),
    targets,
    issues: list,
    ok: !list.some((issue) => issue.severity === "error"),
  };
}

/**
 * {@link describeToolSchema} for a list of tools, with the token total.
 * Also available as `ai.tools.describeAll(tools)`.
 *
 * @example
 * const { tools, tokens } = describeToolSchemas(agentTools);
 */
export function describeToolSchemas(
  tools: ReadonlyArray<Pick<ToolConfig<unknown, unknown>, "name" | "description" | "input">>,
  options: DescribeToolSchemaOptions = {},
): ToolSchemaSummary {
  const reports = tools.map((tool) => describeToolSchema(tool, options));

  return {
    tools: reports,
    tokens: reports.reduce((sum, report) => sum + report.tokens, 0),
    issueCount: reports.reduce((sum, report) => sum + report.issues.length, 0),
  };
}

/** One text block per tool, as the CLI prints it. Uncolored. */
export function formatToolSchemaReports(reports: ReadonlyArray<ToolSchemaReport>): string {
  const lines: string[] = [];

  for (const report of reports) {
    lines.push(
      `${report.name}  ~${report.tokens} tokens  ${report.schemaHash}${report.ok ? "" : "  (has errors)"}`,
    );

    for (const issue of report.issues) {
      const where = issue.path ? ` ${issue.path}` : "";
      lines.push(`  ${issue.severity} [${issue.targets.join(", ")}]${where}: ${issue.message}`);
    }
  }

  return lines.join("\n");
}
