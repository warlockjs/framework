import type { StandardSchemaV1 } from "@standard-schema/spec";
import { tool, type ToolContract } from "@warlock.js/ai";
import { MAX_MULTI_EDITS } from "../ops";
import type {
  MultiEditInput,
  MultiEditOperation,
  MultiEditResult,
  WorkspaceOps,
} from "../contracts";
import { MULTI_EDIT_JSON_SCHEMA } from "./json-schemas";
import { withJsonSchema } from "./schema";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "multi_edit";

/** Validate one element of `edits`. */
function validateEdit(
  value: unknown,
  index: number,
): { edit: MultiEditOperation } | { issues: StandardSchemaV1.Issue[] } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { issues: [{ message: `edits[${index}] must be an object`, path: ["edits", index] }] };
  }

  const candidate = value as Record<string, unknown>;
  const issues: StandardSchemaV1.Issue[] = [];

  if (typeof candidate.oldString !== "string" || candidate.oldString === "") {
    issues.push({
      message: `edits[${index}].oldString must be a non-empty string`,
      path: ["edits", index, "oldString"],
    });
  }

  if (typeof candidate.newString !== "string") {
    issues.push({
      message: `edits[${index}].newString must be a string`,
      path: ["edits", index, "newString"],
    });
  }

  if (candidate.replaceAll !== undefined && typeof candidate.replaceAll !== "boolean") {
    issues.push({
      message: `edits[${index}].replaceAll must be a boolean when provided`,
      path: ["edits", index, "replaceAll"],
    });
  }

  if (
    issues.length > 0 ||
    typeof candidate.oldString !== "string" ||
    typeof candidate.newString !== "string"
  ) {
    return { issues };
  }

  return {
    edit: {
      oldString: candidate.oldString,
      newString: candidate.newString,
      ...(candidate.replaceAll === true ? { replaceAll: true } : {}),
    },
  };
}

/** Input schema for the `multi_edit` tool. */
const inputSchema = withJsonSchema<MultiEditInput>(
  {
    "~standard": {
      version: 1,
      vendor: "ai-workspace",
      validate(value) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          return { issues: [{ message: "input must be an object" }] };
        }

        const candidate = value as Record<string, unknown>;
        const issues: StandardSchemaV1.Issue[] = [];
        const edits: MultiEditOperation[] = [];

        if (typeof candidate.path !== "string" || candidate.path === "") {
          issues.push({ message: '"path" must be a non-empty string', path: ["path"] });
        }

        if (candidate.expectHash !== undefined && typeof candidate.expectHash !== "string") {
          issues.push({
            message: '"expectHash" must be a string when provided',
            path: ["expectHash"],
          });
        }

        if (
          !Array.isArray(candidate.edits) ||
          candidate.edits.length === 0 ||
          candidate.edits.length > MAX_MULTI_EDITS
        ) {
          issues.push({
            message: `"edits" must be an array of 1 to ${MAX_MULTI_EDITS} edits`,
            path: ["edits"],
          });
        } else {
          candidate.edits.forEach((item: unknown, index: number) => {
            const outcome = validateEdit(item, index);

            if ("issues" in outcome) {
              issues.push(...outcome.issues);
            } else {
              edits.push(outcome.edit);
            }
          });
        }

        if (issues.length > 0 || typeof candidate.path !== "string") {
          return { issues };
        }

        return {
          value: {
            path: candidate.path,
            edits,
            ...(typeof candidate.expectHash === "string"
              ? { expectHash: candidate.expectHash }
              : {}),
          },
        };
      },
    },
  },
  MULTI_EDIT_JSON_SCHEMA,
);

/**
 * Build the agent-facing `multi_edit` tool over a workspace's policy-
 * enforced {@link WorkspaceOps}: several exact-string replacements in one
 * file, **atomic** — every edit applies, in order (each against the result
 * of the previous ones), and the file is written once; or one edit fails
 * and nothing is written.
 *
 * Each edit follows the `edit_file` rules: `oldString` must be found, and
 * found exactly once unless `replaceAll`. An optional `expectHash` (from
 * `read_file`) rejects the whole call when the file changed since it was
 * read. A failure surfaces as a `WorkspaceEditError` in the result's
 * `error` field, with `editIndex` naming the failing edit.
 *
 * @param ops - The shared, policy-enforced operation layer.
 * @param options - Optional overrides; `name` renames the LLM-visible tool.
 *
 * @example
 * const multiEdit = makeMultiEditTool(ops);
 * const { data, error } = await multiEdit.invoke({
 *   path: "src/cart.ts",
 *   expectHash,
 *   edits: [
 *     { oldString: "let total = 0;", newString: "let total = 0n;" },
 *     { oldString: "total += price;", newString: "total += BigInt(price);" },
 *   ],
 * });
 */
export function makeMultiEditTool(
  ops: WorkspaceOps,
  options?: { name?: string },
): ToolContract<MultiEditInput, MultiEditResult> {
  return tool<MultiEditInput, MultiEditResult>({
    name: options?.name ?? DEFAULT_NAME,
    description:
      "Make several exact-string replacements in one workspace file at once. " +
      "Edits apply in order, each to the result of the previous; if any " +
      "edit fails (text not found, or not unique without replaceAll) none " +
      "are applied. Pass expectHash (from read_file) to reject the call if " +
      "the file changed since you read it.",
    action: (input) => `Editing ${typeof input.path === "string" ? input.path : "a file"}`,
    input: inputSchema,
    execute: (input) => ops.multiEdit(input),
  });
}
