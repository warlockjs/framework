import { tool, type ToolContract } from "@warlock.js/ai";
import type { ListDirInput, ListDirResult, WorkspaceOps } from "../contracts";
import { LIST_DIR_JSON_SCHEMA } from "./json-schemas";
import {
  objectSchema,
  optionalNumberField,
  optionalStringArrayField,
  optionalStringField,
} from "./schema";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "list_dir";

/** Input schema for the `list_dir` tool. */
const inputSchema = objectSchema<ListDirInput>(
  {
    path: optionalStringField(),
    depth: optionalNumberField(),
    ignore: optionalStringArrayField(),
  },
  LIST_DIR_JSON_SCHEMA,
);

/**
 * Build the agent-facing `list_dir` tool over a workspace's policy-enforced
 * {@link WorkspaceOps}: a bounded, jailed listing of one directory.
 *
 * Entries come back breadth-first (each level sorted by name) with their
 * type and — for files — size, down to `depth` levels (capped by
 * `list.maxDepth`) and at most `list.maxEntries` entries (`truncated` says
 * when the cap hit). `denyPaths` are always left out, as are the
 * `list.ignore` globs (default `node_modules`, `.git`) and any `ignore`
 * globs the model passes. Symlinks are reported as `"symlink"` and never
 * followed. A path outside the jail surfaces as a `WorkspacePolicyError` in
 * the result's `error` field.
 *
 * @param ops - The shared, policy-enforced operation layer.
 * @param options - Optional overrides; `name` renames the LLM-visible tool.
 *
 * @example
 * const listDir = makeListDirTool(ops);
 * const { data } = await listDir.invoke({ path: "src", depth: 2 });
 * for (const entry of data?.entries ?? []) console.log(entry.type, entry.path, entry.size);
 */
export function makeListDirTool(
  ops: WorkspaceOps,
  options?: { name?: string },
): ToolContract<ListDirInput, ListDirResult> {
  return tool<ListDirInput, ListDirResult>({
    name: options?.name ?? DEFAULT_NAME,
    description:
      "List a workspace directory: entries with their type and file size, " +
      "breadth-first, `depth` levels deep (default 1). Dependency and VCS " +
      "folders are left out unless you list them directly.",
    action: (input) => `Listing ${typeof input.path === "string" ? input.path : "."}`,
    input: inputSchema,
    execute: (input) =>
      ops.listDir(input.path ?? ".", {
        ...(input.depth !== undefined ? { depth: input.depth } : {}),
        ...(input.ignore !== undefined ? { ignore: input.ignore } : {}),
      }),
  });
}
