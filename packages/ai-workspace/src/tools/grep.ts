import { type ToolContract, tool } from "@warlock.js/ai";
import { objectSchema, optionalBooleanField, optionalStringField, stringField } from "./schema";
import { GREP_JSON_SCHEMA } from "./json-schemas";
import type { GrepInput, GrepResult, WorkspaceOps } from "../contracts";

/** Options accepted by {@link makeGrepTool} to customize the vended tool. */
export interface MakeGrepToolOptions {
  /**
   * Override the tool name the LLM sees. Defaults to `"grep"`. Use a
   * custom name when wiring several workspaces into one agent so each
   * search surface is addressable.
   */
  name?: string;
}

/**
 * Standard Schema for {@link GrepInput} — `pattern` is a required string;
 * `glob` and `ignoreCase` are optional. Built on the package's shared,
 * dependency-free schema builders (no schema library, matching the
 * validator idiom the `@warlock.js/ai` tool runtime expects).
 */
const grepInputSchema = objectSchema<GrepInput>(
  {
    pattern: stringField(),
    glob: optionalStringField(),
    ignoreCase: optionalBooleanField(),
  },
  GREP_JSON_SCHEMA,
);

/**
 * Build the agent-facing `grep` tool — a regex content search across the
 * jailed file set. The returned {@link ToolContract} validates the LLM's
 * arguments, then delegates verbatim to {@link WorkspaceOps.grep}, so the
 * policy jail, `denyPaths` filtering, and match cap are enforced in the
 * single shared ops layer rather than duplicated here. A policy violation
 * (e.g. a jail-resolution failure) surfaces as typed tool-error *data*
 * via the runtime's `invoke()` wrapper, never as a thrown run-killer.
 *
 * @param ops - The policy-enforced operation layer to delegate to.
 * @param options - Optional `{ name }` override for the vended tool name.
 * @returns A {@link ToolContract} the agent can call as `grep`.
 *
 * @example
 * const grep = makeGrepTool(ops);
 * const { data } = await grep.invoke({ pattern: "TODO", glob: "src/*.ts" });
 * console.log(data?.total, data?.matches);
 */
export function makeGrepTool(
  ops: WorkspaceOps,
  options?: MakeGrepToolOptions,
): ToolContract<GrepInput, GrepResult> {
  return tool<GrepInput, GrepResult>({
    name: options?.name ?? "grep",
    description:
      "Search file contents across the workspace for a regular-expression " +
      "pattern. Optionally narrow the scanned files with a glob and match " +
      "case-insensitively. Returns every matching line with its file path " +
      "and 1-based line number.",
    action: (input) => `Searching for /${input.pattern}/`,
    input: grepInputSchema,
    async execute(input) {
      return ops.grep(input.pattern, {
        glob: input.glob,
        ignoreCase: input.ignoreCase,
      });
    },
  });
}
