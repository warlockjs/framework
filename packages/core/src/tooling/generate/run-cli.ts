import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

/** How one CLI run ended. */
export type CliRun = {
  /** The exit code, or `null` when the process was killed. */
  exitCode: number | null;
  /** The signal that ended it, or `null`. */
  signal: string | null;
  stdout: string;
  stderr: string;
  /** Whether the run hit its timeout and was stopped. */
  timedOut: boolean;
};

/** What a {@link CliRunner} is asked to run: `node <entry> <args>` in `cwd`. */
export type CliInvocation = {
  /** The CLI entry script (the `warlock` bin). */
  entry: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
};

/** Runs the CLI. Injectable so tests never spawn the real one. */
export type CliRunner = (invocation: CliInvocation) => Promise<CliRun>;

/** Two minutes: `add` features run setup hooks; a scaffold is far quicker. */
export const DEFAULT_GENERATION_TIMEOUT_MS = 120_000;

/** Output kept per stream; the rest is dropped (the diff is the result, not the log). */
const MAX_STREAM_BYTES = 256 * 1024;

/**
 * The `warlock` bin the project uses: `<@warlock.js/core>/bin/warlock.js` as
 * the project at `cwd` resolves the package, else the script this process
 * was started with when it is the `warlock` bin.
 *
 * @throws When neither is found; pass the entry explicitly then.
 */
export function resolveCliEntry(cwd = process.cwd()): string {
  try {
    const manifest = createRequire(path.join(cwd, "package.json")).resolve(
      "@warlock.js/core/package.json",
    );

    return path.join(path.dirname(manifest), "bin", "warlock.js");
  } catch {
    // Not resolvable from the project; try the running script.
  }

  const invoked = process.argv[1];

  if (invoked && /^warlock(\.js)?$/.test(path.basename(invoked))) return invoked;

  throw new Error(
    "Could not find the warlock CLI: install @warlock.js/core in the project, or pass cliEntry.",
  );
}

/**
 * The default {@link CliRunner}: spawns `node <entry> <args>` with stdin
 * closed (a prompt reads end-of-input instead of hanging), colors off and
 * `CI=1`, and stops the child it spawned — that one process, by its own
 * handle — when the timeout passes.
 */
export const spawnCli: CliRunner = (invocation) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [invocation.entry, ...invocation.args], {
      cwd: invocation.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < MAX_STREAM_BYTES) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_STREAM_BYTES) stderr += chunk;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, invocation.timeoutMs);

    let settled = false;

    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, timedOut });
    };

    child.on("error", (error) => {
      stderr += `${error.message}\n`;
      finish(null, null);
    });
    child.on("close", (code, signal) => finish(code, signal));
  });

/** ANSI color and cursor sequences. */
const ANSI_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

/** Output a plan carries: stdout then stderr, ANSI stripped, capped. */
export function describeRun(run: CliRun, limit = 16 * 1024): string {
  const text = [run.stdout, run.stderr]
    .map((part) => part.replace(ANSI_SEQUENCE, "").trim())
    .filter((part) => part.length > 0)
    .join("\n");
  const suffix = run.timedOut ? "\n(stopped: the command timed out)" : "";

  return text.length > limit
    ? `${text.slice(0, limit)}\n… (output truncated)${suffix}`
    : `${text}${suffix}`;
}
