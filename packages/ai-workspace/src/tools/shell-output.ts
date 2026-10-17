import { tool, type ToolContract } from "@warlock.js/ai";
import type { ShellOutputInput, ShellOutputResult, WorkspaceOps } from "../contracts";
import { SHELL_OUTPUT_JSON_SCHEMA } from "./json-schemas";
import { objectSchema, optionalNumberField, stringField } from "./schema";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "shell_output";

/** Input schema for the `shell_output` tool. */
const inputSchema = objectSchema<ShellOutputInput>(
  {
    id: stringField(),
    since: optionalNumberField(),
    waitMs: optionalNumberField(),
  },
  SHELL_OUTPUT_JSON_SCHEMA,
);

/**
 * Build the agent-facing `shell_output` tool: the new output of a
 * background command started with `run_shell({ background: true })`, plus
 * its state (`running` / `exited` / `killed` / `timed-out`, `exitCode`).
 *
 * Without `since` it returns everything produced since the previous read;
 * `cursor` in the result is the position to pass as `since` next time.
 * `waitMs` (at most 30 s) waits for new output or for the command to stop
 * when there is nothing new yet — the agent run's signal ends the wait
 * early. Only the newest `shell.maxOutputBytes` of a command's output are
 * kept; `droppedBytes` says how much the reader missed.
 *
 * @param ops - The shared, policy-enforced operation layer.
 * @param options - Optional overrides; `name` renames the LLM-visible tool.
 *
 * @example
 * const { data } = await makeShellOutputTool(ops).invoke({ id: "job-1", waitMs: 2_000 });
 * if (data?.stdout.includes("ready")) console.log("dev server is up");
 */
export function makeShellOutputTool(
  ops: WorkspaceOps,
  options?: { name?: string },
): ToolContract<ShellOutputInput, ShellOutputResult> {
  return tool<ShellOutputInput, ShellOutputResult>({
    name: options?.name ?? DEFAULT_NAME,
    description:
      "Read new output of a background command started with run_shell " +
      "(background: true) and see whether it is still running. Returns " +
      "output since the last read; waitMs waits briefly for more.",
    action: (input) =>
      `Reading output of ${typeof input.id === "string" ? input.id : "a background command"}`,
    input: inputSchema,
    execute: (input, ctx) =>
      ops.shellOutput(input.id, {
        ...(input.since !== undefined ? { since: input.since } : {}),
        ...(input.waitMs !== undefined ? { waitMs: input.waitMs } : {}),
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      }),
  });
}
