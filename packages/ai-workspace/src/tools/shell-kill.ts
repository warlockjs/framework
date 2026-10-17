import { tool, type ToolContract } from "@warlock.js/ai";
import type { ShellJobInfo, ShellKillInput, WorkspaceOps } from "../contracts";
import { SHELL_KILL_JSON_SCHEMA } from "./json-schemas";
import { objectSchema, stringField } from "./schema";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "shell_kill";

/** Input schema for the `shell_kill` tool. */
const inputSchema = objectSchema<ShellKillInput>({ id: stringField() }, SHELL_KILL_JSON_SCHEMA);

/**
 * Build the agent-facing `shell_kill` tool: stop a background command
 * started with `run_shell({ background: true })`, killing its whole process
 * tree, and return its final state. Killing a command that already stopped
 * just reports its state. An unknown id surfaces as a `WorkspaceJobError`
 * in the result's `error` field.
 *
 * @param ops - The shared, policy-enforced operation layer.
 * @param options - Optional overrides; `name` renames the LLM-visible tool.
 *
 * @example
 * const { data } = await makeShellKillTool(ops).invoke({ id: "job-1" });
 * console.log(data?.status); // "killed"
 */
export function makeShellKillTool(
  ops: WorkspaceOps,
  options?: { name?: string },
): ToolContract<ShellKillInput, ShellJobInfo> {
  return tool<ShellKillInput, ShellJobInfo>({
    name: options?.name ?? DEFAULT_NAME,
    description:
      "Stop a background command started with run_shell (background: true), " +
      "killing it and everything it started. Returns its final state.",
    action: (input) =>
      `Stopping ${typeof input.id === "string" ? input.id : "a background command"}`,
    input: inputSchema,
    execute: (input) => ops.shellKill(input.id),
  });
}
