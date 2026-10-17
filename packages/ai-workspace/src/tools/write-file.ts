import { tool, type ToolContract } from "@warlock.js/ai";
import { objectSchema, stringField } from "./schema";
import { WRITE_FILE_JSON_SCHEMA } from "./json-schemas";
import type { WorkspaceOps, WriteFileInput, WriteFileResult } from "../contracts";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "write_file";

/** Input schema for the `write_file` tool. */
const inputSchema = objectSchema<WriteFileInput>(
  {
    path: stringField(),
    content: stringField(),
  },
  WRITE_FILE_JSON_SCHEMA,
);

/**
 * Build the agent-facing `write_file` tool over a workspace's policy-
 * enforced {@link WorkspaceOps}.
 *
 * The tool validates `{ path, content }` against a Standard Schema, then
 * delegates to `ops.writeFile`, which atomically writes the full content
 * (creating parent directories) and returns the byte count and content
 * `hash`. The tool re-attaches the workspace-relative `path` so the
 * result matches the {@link WriteFileResult} wire shape.
 *
 * **Errors flow as data.** A jail escape is thrown by `ops`; the
 * `tool()` wrapper catches it and surfaces it in the returned `{ error }`
 * field — `invoke()` never throws.
 *
 * @param ops - The shared, policy-enforced operation layer.
 * @param options - Optional overrides; `name` renames the LLM-visible tool.
 *
 * @example
 * const writeTool = makeWriteFileTool(ops);
 * const { data } = await writeTool.invoke({ path: "src/new.ts", content: "export {};" });
 * console.log(data.bytesWritten, data.hash);
 */
export function makeWriteFileTool(
  ops: WorkspaceOps,
  options?: { name?: string },
): ToolContract<WriteFileInput, WriteFileResult> {
  return tool<WriteFileInput, WriteFileResult>({
    name: options?.name ?? DEFAULT_NAME,
    description:
      "Write full content to a workspace file, creating it (and any parent " +
      "directories) if absent and overwriting it otherwise. The write is " +
      "atomic. Returns the bytes written and the new content hash.",
    input: inputSchema,
    async execute(input) {
      const { hash, bytesWritten } = await ops.writeFile(input.path, input.content);

      return { path: input.path, bytesWritten, hash };
    },
  });
}
