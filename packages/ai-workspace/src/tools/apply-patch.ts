import type { StandardSchemaV1 } from "@standard-schema/spec";
import { tool, type ToolContract } from "@warlock.js/ai";
import type { ApplyPatchInput, ApplyPatchResult, WorkspaceOps } from "../contracts";
import { applyPatchWithOps } from "../patch/apply-patch-generic";
import { APPLY_PATCH_JSON_SCHEMA } from "./json-schemas";
import { withJsonSchema } from "./schema";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "apply_patch";

/** Input schema for the `apply_patch` tool. */
const inputSchema = withJsonSchema<ApplyPatchInput>(
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

        if (typeof candidate.patch !== "string" || candidate.patch.trim() === "") {
          issues.push({ message: '"patch" must be a non-empty string', path: ["patch"] });
        }

        if (candidate.dryRun !== undefined && typeof candidate.dryRun !== "boolean") {
          issues.push({ message: '"dryRun" must be a boolean when provided', path: ["dryRun"] });
        }

        if (issues.length > 0 || typeof candidate.patch !== "string") {
          return { issues };
        }

        return {
          value: {
            patch: candidate.patch,
            ...(candidate.dryRun === true ? { dryRun: true } : {}),
          },
        };
      },
    },
  },
  APPLY_PATCH_JSON_SCHEMA,
);

/**
 * Build the agent-facing `apply_patch` tool over a workspace's policy-enforced
 * {@link WorkspaceOps}: apply a unified diff that modifies, creates, deletes
 * and renames files. It is **atomic** — every hunk of every file applies, or
 * nothing on disk changes — every path stays inside the workspace jail, and a
 * patch that touches a binary file is refused with a clear error. A failure
 * surfaces as a `WorkspaceEditError` in the result's `error` field.
 *
 * @param ops - The shared, policy-enforced operation layer.
 * @param options - Optional overrides; `name` renames the LLM-visible tool.
 *
 * @example
 * const patch = makeApplyPatchTool(ops);
 * const { data, error } = await patch.invoke({
 *   patch: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
 * });
 */
export function makeApplyPatchTool(
  ops: WorkspaceOps,
  options?: { name?: string },
): ToolContract<ApplyPatchInput, ApplyPatchResult> {
  return tool<ApplyPatchInput, ApplyPatchResult>({
    name: options?.name ?? DEFAULT_NAME,
    description:
      "Apply a unified diff to the workspace: modify, create (--- /dev/null), " +
      "delete (+++ /dev/null) and rename (git rename from/to) files in one call. " +
      "All of it applies or none of it does. Hunks are located by their context, " +
      "so small line drift is fine; binary files are refused. Use dryRun to check first.",
    action: (input) => (input.dryRun === true ? "Checking a patch" : "Applying a patch"),
    input: inputSchema,
    execute: (input) => (ops.applyPatch ? ops.applyPatch(input) : applyPatchWithOps(ops, input)),
  });
}
