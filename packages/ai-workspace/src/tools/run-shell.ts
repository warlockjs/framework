import type { StandardSchemaV1 } from "@standard-schema/spec";
import { tool, type ToolContract } from "@warlock.js/ai";
import { WorkspacePolicyError } from "../errors";
import type {
  RunShellBackgroundResult,
  RunShellInput,
  RunShellResult,
  WorkspaceOps,
} from "../contracts";
import { runShellJsonSchema } from "./json-schemas";
import { withJsonSchema } from "./schema";

/** The default tool name `run_shell` is exposed to the LLM under. */
const DEFAULT_RUN_SHELL_TOOL_NAME = "run_shell";

/**
 * Hand-rolled Standard Schema for {@link RunShellInput}. We validate the
 * model's arguments without a runtime schema dependency: `command` must be
 * a non-empty string, `timeoutMs` (when present) a positive number and
 * `background` (when present) a boolean. Invalid args surface as a
 * `SchemaValidationError` in the tool result's `error` field rather than
 * reaching `ops.exec`.
 */
function runShellInputSchema(background: boolean): StandardSchemaV1<RunShellInput> {
  const schema: StandardSchemaV1<RunShellInput> = {
    "~standard": {
      version: 1,
      vendor: "@warlock.js/ai-workspace",
      validate: (value) => {
        if (typeof value !== "object" || value === null) {
          return { issues: [{ message: "expected an object" }] };
        }

        const candidate = value as Record<string, unknown>;

        if (typeof candidate.command !== "string" || candidate.command.length === 0) {
          return {
            issues: [{ message: "command must be a non-empty string", path: ["command"] }],
          };
        }

        if (
          candidate.timeoutMs !== undefined &&
          (typeof candidate.timeoutMs !== "number" || candidate.timeoutMs <= 0)
        ) {
          return {
            issues: [{ message: "timeoutMs must be a positive number", path: ["timeoutMs"] }],
          };
        }

        if (candidate.background !== undefined && typeof candidate.background !== "boolean") {
          return {
            issues: [{ message: "background must be a boolean", path: ["background"] }],
          };
        }

        const result: RunShellInput = { command: candidate.command };

        if (typeof candidate.timeoutMs === "number") {
          result.timeoutMs = candidate.timeoutMs;
        }

        if (candidate.background === true) {
          result.background = true;
        }

        return { value: result };
      },
    },
  };

  return withJsonSchema(schema, runShellJsonSchema(background));
}

/** Options for {@link makeRunShellTool}. */
export interface MakeRunShellToolOptions {
  /** Override the tool name exposed to the LLM (default `"run_shell"`). */
  name?: string;
  /**
   * Upper bound for a model-supplied `timeoutMs` on a foreground command —
   * the model can lower the timeout, never raise it past this. The
   * workspace passes its `shell.timeoutMs`.
   */
  maxTimeoutMs?: number;
  /**
   * Accept `background: true` and start the command as a background job
   * (`ops.startShell`), returning a {@link RunShellBackgroundResult}. The
   * workspace sets it when the policy has `shell.background`. Default
   * `false`: a background request is refused.
   */
  background?: boolean;
}

/** The lower of the model's timeout and the cap (either may be absent). */
function cappedTimeout(requested: number | undefined, cap: number | undefined): number | undefined {
  if (requested === undefined) {
    return cap;
  }

  return cap === undefined ? requested : Math.min(requested, cap);
}

/**
 * Build the `run_shell` tool — a {@link ToolContract} that runs a command
 * line through the policy-enforced {@link WorkspaceOps} layer.
 *
 * Every command in the line is checked against the shell policy by
 * `ops.exec`; a refused line throws a `WorkspacePolicyError` (with a
 * `reason` and a message that says how to fix the command) which the
 * `tool()` runtime catches and surfaces in the result's `error` field
 * (never a thrown run-killer), so the agent reads the refusal as tool data
 * and self-corrects. A command that runs but exits non-zero is *not* an
 * error — its `exitCode`/`stderr` come back in `data` for the agent to
 * inspect.
 *
 * The agent run's cancellation `signal` (from the dispatch `ctx`) is passed
 * to `ops.exec` per invocation: a cancelled run never starts the command,
 * and one cancelled mid-command kills its process tree (`cancelled: true`).
 * A background command (`background: true`, when enabled) belongs to the
 * workspace instead and keeps running after the call returns.
 *
 * @param ops - The policy-enforced operation layer to delegate `exec` to.
 * @param options - Tool-name override, timeout cap and background support.
 *
 * @example
 * const runShell = makeRunShellTool(ops);
 * const { data, error } = await runShell.invoke({ command: "npm run build" });
 * if (error) handleDenied(error);
 * else console.log(data.exitCode, data.stdout);
 */
export function makeRunShellTool(
  ops: WorkspaceOps,
  options?: MakeRunShellToolOptions & { background?: false },
): ToolContract<RunShellInput, RunShellResult>;
export function makeRunShellTool(
  ops: WorkspaceOps,
  options: MakeRunShellToolOptions & { background: true },
): ToolContract<RunShellInput, RunShellResult | RunShellBackgroundResult>;
export function makeRunShellTool(
  ops: WorkspaceOps,
  options?: MakeRunShellToolOptions,
): ToolContract<RunShellInput, RunShellResult | RunShellBackgroundResult>;
export function makeRunShellTool(
  ops: WorkspaceOps,
  options?: MakeRunShellToolOptions,
): ToolContract<RunShellInput, RunShellResult | RunShellBackgroundResult> {
  const background = options?.background === true;

  return tool<RunShellInput, RunShellResult | RunShellBackgroundResult>({
    name: options?.name ?? DEFAULT_RUN_SHELL_TOOL_NAME,
    description:
      "Run a shell command inside the workspace. Every command in it must be " +
      "permitted by the shell policy; a refusal explains how to fix the " +
      "command. Output is byte-capped and the run is time-limited. A " +
      "non-zero exit code is returned as data, not an error." +
      (background
        ? " Pass background: true for a long-running command (dev server, " +
          "watcher): it returns an id at once; read its output with " +
          "shell_output and stop it with shell_kill."
        : ""),
    action: (input) => `Running \`${input.command}\``,
    input: runShellInputSchema(background),
    // The run's signal belongs to this one invocation: it is read from the
    // dispatch ctx on every call and never stored on the tool or workspace.
    execute: async (input, ctx) => {
      if (input.background === true) {
        if (!background) {
          throw new WorkspacePolicyError(
            "Background commands are not enabled for this workspace; run the command without background.",
            { type: "denied-command", reason: "not-allowed", command: input.command },
          );
        }

        const job = await ops.startShell(
          input.command,
          input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : undefined,
        );

        return { ...job, background: true };
      }

      const timeoutMs = cappedTimeout(input.timeoutMs, options?.maxTimeoutMs);

      return ops.exec(input.command, {
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      });
    },
  });
}
