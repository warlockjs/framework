import { tool, type ToolContract } from "@warlock.js/ai";
import { objectSchema, optionalNumberField, stringField } from "./schema";
import type { ReadFileInput, ReadFileResult, WorkspaceOps } from "../contracts";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "read_file";

/** Input schema for the `read_file` tool. */
const inputSchema = objectSchema<ReadFileInput>({
  path: stringField(),
  startLine: optionalNumberField(),
  limit: optionalNumberField(),
});

/**
 * Build the agent-facing `read_file` tool over a workspace's policy-
 * enforced {@link WorkspaceOps}.
 *
 * The tool validates `{ path, startLine?, limit? }` against a Standard
 * Schema, then delegates to `ops.readFile`, mapping the result into the
 * agent wire shape {@link ReadFileResult} — the `hash` an agent must
 * carry into a later `edit_file` (read-before-edit), plus the `startLine`
 * / `endLine` / `truncated` window metadata derived from the requested
 * range and the file's `totalLines`.
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
      "through large files.",
    input: inputSchema,
    async execute(input) {
      const startLine = input.startLine !== undefined ? Math.max(1, input.startLine) : 1;
      const { content, hash, totalLines } = await ops.readFile(input.path, {
        offset: startLine,
        limit: input.limit,
      });

      // The window's last line is the start plus however many lines the
      // ops layer actually returned (it caps at `limit` / the policy
      // default), bounded by the file's end.
      const returnedLines = content.length === 0 ? 0 : content.split("\n").length;
      const endLine = Math.min(totalLines, startLine + Math.max(returnedLines, 1) - 1);
      const truncated = endLine < totalLines;

      return { content, startLine, endLine, totalLines, truncated, hash };
    },
  });
}
