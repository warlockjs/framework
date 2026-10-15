import type { StandardSchemaV1 } from "@standard-schema/spec";
import { tool, type ToolContract } from "@warlock.js/ai";
import type {
  RunShellResult,
  RunTestsInput,
  WorkspaceOps,
} from "../contracts";

/** The default tool name `run_tests` is exposed to the LLM under. */
const DEFAULT_RUN_TESTS_TOOL_NAME = "run_tests";

/** The default command run when no `command` override is configured. */
const DEFAULT_TEST_COMMAND = "npm test";

/**
 * Hand-rolled Standard Schema for {@link RunTestsInput}. `pattern` is the
 * only field and is optional; when present it must be a string without
 * double quotes or newlines — the pattern is forwarded to the runner as a
 * single double-quoted argument, and those characters would break out of
 * the quoting (i.e. inject extra arguments or commands). Validation
 * happens without a runtime schema dependency, mirroring the wider tool
 * layer.
 */
const runTestsInputSchema: StandardSchemaV1<RunTestsInput> = {
  "~standard": {
    version: 1,
    vendor: "@warlock.js/ai-workspace",
    validate: (value) => {
      // A no-argument call (the common case) is valid and runs the bare
      // test command.
      if (value === undefined || value === null) {
        return { value: {} };
      }

      if (typeof value !== "object") {
        return { issues: [{ message: "expected an object" }] };
      }

      const candidate = value as Record<string, unknown>;

      if (candidate.pattern !== undefined && typeof candidate.pattern !== "string") {
        return { issues: [{ message: "pattern must be a string", path: ["pattern"] }] };
      }

      if (typeof candidate.pattern === "string" && /["\r\n]/.test(candidate.pattern)) {
        return {
          issues: [
            {
              message: "pattern must not contain double quotes or newlines",
              path: ["pattern"],
            },
          ],
        };
      }

      const result: RunTestsInput = {};

      if (candidate.pattern !== undefined) {
        result.pattern = candidate.pattern as string;
      }

      return { value: result };
    },
  },
};

/** Options for {@link makeRunTestsTool}. */
export interface MakeRunTestsToolOptions {
  /** Override the tool name exposed to the LLM (default `"run_tests"`). */
  name?: string;
  /**
   * The base test command to run (default `"npm test"`). When the model
   * supplies a `pattern`, it is appended to this command as a single
   * quoted argument.
   */
  command?: string;
}

/**
 * Build the `run_tests` tool — a {@link ToolContract} convenience over
 * `run_shell` that runs the workspace's configured test command through
 * the policy-enforced {@link WorkspaceOps} layer.
 *
 * The base command defaults to `"npm test"` and can be overridden via
 * `options.command`. When the model passes a `pattern`, it is appended to
 * the command as a **single quoted argument** — a path/suite filter the
 * tokenizer hands to the runner as one argv element (e.g.
 * `npm test "src/cart"`), so shell metacharacters inside it are literal
 * data, never a second command. Like `run_shell`, the resolved command's
 * executable is gated by the shell policy — a denial surfaces in the
 * result's `error` field — and a non-zero exit (failing tests) comes back
 * as `data` for the agent to read and fix. The agent run's cancellation
 * `signal` is threaded per invocation, exactly as for `run_shell`.
 *
 * @param ops - The policy-enforced operation layer to delegate `exec` to.
 * @param options - Optional tool-name and base-command overrides.
 *
 * @example
 * const runTests = makeRunTestsTool(ops, { command: "pnpm test" });
 * const { data } = await runTests.invoke({ pattern: "cart-total" });
 * if (data.exitCode !== 0) inspect(data.stderr);
 */
export function makeRunTestsTool(
  ops: WorkspaceOps,
  options?: MakeRunTestsToolOptions,
): ToolContract<RunTestsInput, RunShellResult> {
  const baseCommand = options?.command ?? DEFAULT_TEST_COMMAND;

  return tool<RunTestsInput, RunShellResult>({
    name: options?.name ?? DEFAULT_RUN_TESTS_TOOL_NAME,
    description:
      "Run the workspace's test suite, optionally narrowed to a path or " +
      "name pattern forwarded to the test runner. Failing tests return a " +
      "non-zero exit code as data, not an error.",
    action: (input) =>
      input.pattern ? `Running tests matching "${input.pattern}"` : "Running tests",
    input: runTestsInputSchema,
    execute: (input, ctx) => {
      // The pattern rides as ONE double-quoted token (quotes/newlines are
      // rejected by the schema), so it reaches the runner as a single argv
      // element and can never smuggle in additional commands or arguments.
      const command = input.pattern ? `${baseCommand} "${input.pattern}"` : baseCommand;

      return ops.exec(command, ctx?.signal ? { signal: ctx.signal } : undefined);
    },
  });
}
