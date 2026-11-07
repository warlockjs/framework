import { type ToolContract, tool } from "@warlock.js/ai";
import { objectSchema, stringField } from "./schema";
import { GLOB_JSON_SCHEMA } from "./json-schemas";
import type { GlobInput, GlobResult, WorkspaceOps } from "../contracts";

/** Options accepted by {@link makeGlobTool} to customize the vended tool. */
export interface MakeGlobToolOptions {
  /**
   * Override the tool name the LLM sees. Defaults to `"glob"`. Use a
   * custom name when wiring several workspaces into one agent so each
   * path-match surface is addressable.
   */
  name?: string;
}

/**
 * Standard Schema for {@link GlobInput} — a single required `pattern`
 * string. Built on the package's shared, dependency-free schema builders
 * (no schema library, matching the validator idiom the `@warlock.js/ai`
 * tool runtime expects).
 */
const globInputSchema = objectSchema<GlobInput>(
  {
    pattern: stringField(),
  },
  GLOB_JSON_SCHEMA,
);

/**
 * Build the agent-facing `glob` tool — resolve a glob pattern to the
 * matching workspace-relative paths within the jail. The returned
 * {@link ToolContract} validates the LLM's arguments, delegates to
 * {@link WorkspaceOps.glob} (which returns a bare sorted `string[]`), and
 * wraps the result in a {@link GlobResult} so the agent always reads a
 * stable `{ paths }` envelope. The jail and `denyPaths` filtering are
 * enforced in the shared ops layer; a policy violation surfaces as typed
 * tool-error *data* via the runtime's `invoke()` wrapper.
 *
 * @param ops - The policy-enforced operation layer to delegate to.
 * @param options - Optional `{ name }` override for the vended tool name.
 * @returns A {@link ToolContract} the agent can call as `glob`.
 *
 * @example
 * const glob = makeGlobTool(ops);
 * const { data } = await glob.invoke({ pattern: "src/models/**\/*.ts" });
 * console.log(data?.paths);
 */
export function makeGlobTool(
  ops: WorkspaceOps,
  options?: MakeGlobToolOptions,
): ToolContract<GlobInput, GlobResult> {
  return tool<GlobInput, GlobResult>({
    name: options?.name ?? "glob",
    description:
      "Find files in the workspace whose path matches a glob pattern " +
      "(supports `*`, `**`, and `?`). Returns the matching " +
      "workspace-relative paths, sorted. Skips node_modules, .git and " +
      "gitignored folders; start the pattern with a folder (`src/**/*.ts`) to search faster.",
    action: (input) => `Finding files matching ${input.pattern}`,
    input: globInputSchema,
    readOnly: true,
    async execute(input, ctx) {
      const opts = ctx?.signal ? { signal: ctx.signal } : undefined;

      if (ops.globResult !== undefined) {
        return ops.globResult(input.pattern, opts);
      }

      const paths = await ops.glob(input.pattern, opts);

      return { paths };
    },
  });
}
