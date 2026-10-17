import { tool, type ToolContract } from "@warlock.js/ai";
import { objectSchema, optionalNumberField, stringField } from "./schema";
import { READ_FILE_JSON_SCHEMA } from "./json-schemas";
import type { ReadFileInput, ReadFileResult, WorkspaceOps } from "../contracts";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "read_file";

/** Input schema for the `read_file` tool. */
const inputSchema = objectSchema<ReadFileInput>(
  {
    path: stringField(),
    startLine: optionalNumberField(),
    limit: optionalNumberField(),
  },
  READ_FILE_JSON_SCHEMA,
);

/**
 * Build the agent-facing `read_file` tool over a workspace's policy-
 * enforced {@link WorkspaceOps}.
 *
 * The tool validates `{ path, startLine?, limit? }` against a Standard
 * Schema, then delegates to `ops.readFile`, mapping the result into the
 * agent wire shape {@link ReadFileResult} — the full file's `hash` an
 * agent must carry into a later `edit_file` (read-before-edit), plus the
 * `startLine` / `endLine` / `truncated` / `bytesCapped` window metadata.
 * The returned `content` never exceeds the policy's `read.maxBytes`.
 *
 * **Errors flow as data.** Policy violations (a jail escape) are thrown
 * by `ops`; the `tool()` wrapper catches them and surfaces them in the
 * returned `{ error }` field — `invoke()` never throws — so the agent can
 * read the failure and self-correct.
 *
 * @param ops - The shared, policy-enforced operation layer.
 * @param options - Optional overrides; `name` renames the LLM-visible tool.
 *
 * @example
 * const readTool = makeReadFileTool(ops);
 * const { data, error } = await readTool.invoke({ path: "src/index.ts" });
 * if (!error) console.log(data.hash); // feed into edit_file's expectHash
 */
export function makeReadFileTool(
  ops: WorkspaceOps,
  options?: { name?: string },
): ToolContract<ReadFileInput, ReadFileResult> {
  return tool<ReadFileInput, ReadFileResult>({
    name: options?.name ?? DEFAULT_NAME,
    description:
      "Read a file from the workspace, returning a numbered line window plus " +
      "the file's content hash. Pass the hash to edit_file's expectHash to " +
      "guard against editing a stale version. Use startLine/limit to page " +
      "through large files. Output is byte-capped by the workspace policy; " +
      "when bytesCapped is true the last returned line may be cut short.",
    input: inputSchema,
    async execute(input) {
      // The ops layer owns the window and byte-cap arithmetic, so the tool
      // and the direct `readFile()` return identical results for the same
      // arguments.
      return ops.readFile(input.path, {
        offset: input.startLine !== undefined ? Math.max(1, input.startLine) : 1,
        limit: input.limit,
      });
    },
  });
}
