import type { StandardSchemaV1 } from "@standard-schema/spec";
import { tool, type ToolContract } from "@warlock.js/ai";
import type { RunShellInput, RunShellResult, WorkspaceOps } from "../contracts";

/** The default tool name `run_shell` is exposed to the LLM under. */
const DEFAULT_RUN_SHELL_TOOL_NAME = "run_shell";

/**
 * Hand-rolled Standard Schema for {@link RunShellInput}. We validate the
 * model's arguments without a runtime schema dependency: `command` must be
 * a non-empty string, and `timeoutMs` (when present) a positive number.
 * Invalid args surface as a `SchemaValidationError` in the tool result's
 * `error` field rather than reaching `ops.exec`.
 */
const runShellInputSchema: StandardSchemaV1<RunShellInput> = {
  "~standard": {
    version: 1,
    vendor: "@warlock.js/ai-workspace",
    validate: (value) => {
      if (typeof value !== "object" || value === null) {
        return { issues: [{ message: "expected an object" }] };
      }

      const candidate = value as Record<string, unknown>;

      if (typeof candidate.command !== "string" || candidate.command.length === 0) {
        return { issues: [{ message: "command must be a non-empty string", path: ["command"] }] };
      }

      if (
        candidate.timeoutMs !== undefined &&
        (typeof candidate.timeoutMs !== "number" || candidate.timeoutMs <= 0)
      ) {
        return {
          issues: [{ message: "timeoutMs must be a positive number", path: ["timeoutMs"] }],
        };
      }

      const result: RunShellInput = { command: candidate.command };

      if (candidate.timeoutMs !== undefined) {
        result.timeoutMs = candidate.timeoutMs as number;
      }

      return { value: result };
    },
  },
};

/** Options for {@link makeRunShellTool}. */
export interface MakeRunShellToolOptions {
  /** Override the tool name exposed to the LLM (default `"run_shell"`). */
  name?: string;
}

/**
 * Build the `run_shell` tool — a {@link ToolContract} that runs a single
 * shell command through the policy-enforced {@link WorkspaceOps} layer.
 *
 * The command's leading executable basename is gated against the shell
 * allow/deny policy by `ops.exec`; a blocked command throws a
 * `WorkspacePolicyError` which the `tool()` runtime catches and surfaces
 * in the result's `error` field (never a thrown run-killer), so the agent
 * reads the refusal as tool data and self-corrects. A command that runs
 * but exits non-zero is *not* an error — its `exitCode`/`stderr` come back
 * in `data` for the agent to inspect.
 *
 * The agent run's cancellation `signal` (from the dispatch `ctx`) is passed
 * to `ops.exec` per invocation: a cancelled run never starts the command,
 * and one cancelled mid-command kills its process tree (`cancelled: true`).
 *
 * @param ops - The policy-enforced operation layer to delegate `exec` to.
 * @param options - Optional tool-name override.
 *
 * @example
 * const runShell = makeRunShellTool(ops);
 * const { data, error } = await runShell.invoke({ command: "npm run build" });
 * if (error) handleDenied(error);
 * else console.log(data.exitCode, data.stdout);
 */
export function makeRunShellTool(
  ops: WorkspaceOps,
  options?: MakeRunShellToolOptions,
): ToolContract<RunShellInput, RunShellResult> {
  return tool<RunShellInput, RunShellResult>({
    name: options?.name ?? DEFAULT_RUN_SHELL_TOOL_NAME,
    description:
      "Run a single shell command inside the workspace. The command's " +
      "executable must be permitted by the shell policy; output is " +
      "byte-capped and the run is time-limited. A non-zero exit code is " +
      "returned as data, not an error.",
    action: (input) => `Running \`${input.command}\``,
    input: runShellInputSchema,
    // The run's signal belongs to this one invocation: it is read from the
    // dispatch ctx on every call and never stored on the tool or workspace.
    execute: (input, ctx) =>
      ops.exec(input.command, {
        timeoutMs: input.timeoutMs,
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      }),
  });
}
