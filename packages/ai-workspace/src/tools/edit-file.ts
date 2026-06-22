import { tool, type ToolContract } from "@warlock.js/ai";
import {
  objectSchema,
  optionalBooleanField,
  optionalStringField,
  stringField,
} from "./schema";
import type { EditFileInput, EditFileResult, WorkspaceOps } from "../contracts";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "edit_file";

/** Input schema for the `edit_file` tool. */
const inputSchema = objectSchema<EditFileInput>({
  path: stringField(),
  oldString: stringField(),
  newString: stringField(),
  replaceAll: optionalBooleanField(),
  expectHash: optionalStringField(),
});

/**
 * Build the agent-facing `edit_file` tool over a workspace's policy-
 * enforced {@link WorkspaceOps}.
 *
 * The tool validates `{ path, oldString, newString, replaceAll?,
 * expectHash? }` against a Standard Schema, then delegates to
 * `ops.editFile`, which applies the exact-string replacement under the
 * read-before-edit guard and returns the replacement count plus the
 * post-edit `hash`.
 *
 * **Errors flow as data.** A non-unique `oldString` (without
 * `replaceAll`), a missing `oldString`, or a stale `expectHash` cause
 * `ops` to throw a `WorkspaceEditError`; the `tool()` wrapper catches it
 * and surfaces it in the returned `{ error }` field — `invoke()` never
 * throws — so the agent can re-read and retry.
 *
 * @param ops - The shared, policy-enforced operation layer.
 * @param options - Optional overrides; `name` renames the LLM-visible tool.
 *
 * @example
 * const editTool = makeEditFileTool(ops);
 * const { data, error } = await editTool.invoke({
 *   path: "src/index.ts",
 *   oldString: "const a = 1;",
 *   newString: "const a = 2;",
 *   expectHash,
 * });
 * if (error) console.warn(error.message); // e.g. stale-hash → re-read
 */
export function makeEditFileTool(
  ops: WorkspaceOps,
  options?: { name?: string },
): ToolContract<EditFileInput, EditFileResult> {
  return tool<EditFileInput, EditFileResult>({
    name: options?.name ?? DEFAULT_NAME,
    description:
      "Replace an exact substring in a workspace file. oldString must match " +
      "uniquely unless replaceAll is set. Pass expectHash (from read_file) to " +
      "reject the edit if the file changed since you read it. Returns the " +
      "number of replacements and the new content hash.",
    input: inputSchema,
    async execute(input) {
      return ops.editFile(input);
    },
  });
}
