import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { platform } from "node:process";
import { StringDecoder } from "node:string_decoder";
import { fs } from "@warlock.js/fs";
import { tokenizeCommand } from "../policy/tokenize-command";
import type { WorkspaceShellInterpreter } from "../contracts/workspace-policy.type";
import type {
  WorkspaceBackend,
  WorkspaceBackendExecOptions,
  WorkspaceBackendExecResult,
  WorkspaceBackendProcess,
  WorkspaceBackendStartOptions,
  WorkspaceBackendStat,
} from "../contracts/workspace-backend.contract";

/**
 * Hard ceiling on captured `stdout`/`stderr` per stream, in bytes. The raw
 * executor truncates each stream once this many bytes have accumulated so a
 * runaway command cannot exhaust memory; the ops layer applies its own
 * policy-driven cap (and the `truncated` flag) on top. Generous enough that
 * ordinary command output is never clipped here.
 */
const MAX_STREAM_BYTES = 10 * 1024 * 1024;

/**
 * Append a chunk to a capped list of buffers, tracking the running byte
 * total and stopping once {@link MAX_STREAM_BYTES} is reached. Trailing bytes
 * past the cap are dropped rather than buffered.
 */
function pushCapped(chunks: Buffer[], total: number, chunk: Buffer): number {
  if (total >= MAX_STREAM_BYTES) {
    return total;
  }

  const remaining = MAX_STREAM_BYTES - total;

  if (chunk.length <= remaining) {
    chunks.push(chunk);

    return total + chunk.length;
  }

  chunks.push(chunk.subarray(0, remaining));

  return MAX_STREAM_BYTES;
}

/**
 * Force-kill a spawned command and its entire process tree.
 *
 * The direct child may have grandchildren (on Windows it is the `cmd.exe`
 * wrapper around a batch shim; anywhere, an allowed `npm`/`node` can spawn
 * further processes), so signalling the direct child alone could leave a
 * long-running grandchild alive and the `exec` promise unsettled. We
 * therefore kill the whole group:
 *   - **Windows** — `taskkill /T /F` walks and terminates the PID's tree.
 *   - **POSIX** — the child is spawned `detached`, becoming its own process
 *     group leader, so `process.kill(-pid)` SIGKILLs the group.
 */
function killTree(pid: number | undefined, child: { kill(signal: NodeJS.Signals): boolean }): void {
  if (pid === undefined) {
    child.kill("SIGKILL");

    return;
  }

  if (platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });

    // Without a listener a failed spawn (taskkill missing from PATH) is an
    // unhandled 'error' event that crashes the process; fall back to the
    // direct child instead.
    killer.on("error", () => {
      child.kill("SIGKILL");
    });

    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group may already be gone; fall back to the direct child.
    child.kill("SIGKILL");
  }
}

/**
 * Argument bytes `cmd.exe` cannot carry safely even inside double quotes:
 * an embedded quote breaks out of the quoted span, `%` triggers variable
 * expansion regardless of quoting, and newlines end the command line. An
 * argv containing any of these is refused rather than risked (the
 * BatBadBut / CVE-2024-24576 class of `cmd.exe` argument smuggling).
 */
const WIN32_UNSAFE_ARGUMENT = /["%\r\n]/;

/**
 * Build the `cmd.exe` invocation that runs an argv on Windows. Batch shims
 * (`npm.cmd`, `npx.cmd`, …) cannot be spawned directly without a shell
 * (Node rejects them since CVE-2024-27980), so the argv is run through
 * `cmd.exe /d /s /c` with every element individually double-quoted —
 * quoted spans are literal to cmd's parser, so pipes/ampersands inside an
 * argument stay argument data. Returns `null` when an element contains a
 * byte cmd cannot quote safely (see {@link WIN32_UNSAFE_ARGUMENT}).
 *
 * The caller must spawn with `windowsVerbatimArguments: true` so Node does
 * not re-quote the already-quoted command line.
 */
function toWin32CmdInvocation(argv: string[]): { file: string; args: string[] } | null {
  if (argv.some((element) => WIN32_UNSAFE_ARGUMENT.test(element))) {
    return null;
  }

  const commandLine = argv.map((element) => `"${element}"`).join(" ");

  return {
    file: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${commandLine}"`],
  };
}

/** The shell a POSIX shell-mode line runs through — an absolute path, never a PATH lookup. */
const POSIX_SHELL = "/bin/sh";

/** How to spawn a command line, or why it cannot be spawned. */
type SpawnPlan =
  | { file: string; args: string[]; windowsVerbatimArguments: boolean }
  | { refused: string };

/**
 * Work out the spawn for a command line.
 *
 * - argv mode: tokenize (no shell semantics) and spawn the argv directly —
 *   on Windows through an individually-quoted `cmd.exe` wrapper.
 * - shell mode: `/bin/sh -c <line>`, or `cmd.exe /d /v:off /s /c "<line>"`
 *   on Windows (`/d` skips AutoRun, `/v:off` disables delayed `!` expansion,
 *   `/s` keeps the line verbatim inside the outer quotes). The ops layer has
 *   already checked every command in the line.
 */
function planSpawn(command: string, interpreter: WorkspaceShellInterpreter): SpawnPlan {
  if (interpreter === "sh") {
    if (platform === "win32") {
      return {
        file: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/v:off", "/s", "/c", `"${command}"`],
        windowsVerbatimArguments: true,
      };
    }

    return { file: POSIX_SHELL, args: ["-c", command], windowsVerbatimArguments: false };
  }

  const argv = tokenizeCommand(command);
  const executable = argv?.[0];

  if (argv === null || executable === undefined) {
    return {
      refused:
        "Command was not executed: it is empty, has unbalanced quotes, or " +
        "contains unquoted shell metacharacters (;, &, |, `, $, <, >, " +
        "parentheses). Commands run without a shell — pass metacharacters " +
        "inside quotes as literal arguments, or run one command at a time.",
    };
  }

  if (platform === "win32") {
    const invocation = toWin32CmdInvocation(argv);

    if (invocation === null) {
      return {
        refused:
          'Command was not executed: on Windows, arguments containing ", %, ' +
          "or newlines cannot be passed to cmd.exe safely.",
      };
    }

    return { ...invocation, windowsVerbatimArguments: true };
  }

  return { file: executable, args: argv.slice(1), windowsVerbatimArguments: false };
}

/**
 * Kill functions of every background process still running, so they can
 * be reaped if the Node process exits without the workspace being disposed
 * (detached process groups would otherwise outlive it).
 */
const liveBackgroundKills = new Set<() => void>();

let exitHookInstalled = false;

/** Track a live background tree; installs (once) the exit hook that kills them. */
function trackBackgroundProcess(kill: () => void): () => void {
  liveBackgroundKills.add(kill);

  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on("exit", () => {
      for (const killTreeNow of liveBackgroundKills) {
        killTreeNow();
      }
    });
  }

  return () => {
    liveBackgroundKills.delete(kill);
  };
}

/**
 * The real-disk executor: every filesystem method delegates to
 * `@warlock.js/fs` (never `node:fs`), and {@link LocalBackend.exec} spawns a
 * process via `node:child_process`. It is deliberately **policy-agnostic** —
 * it receives already-resolved absolute paths and an already-resolved
 * environment + timeout from the ops layer, and just performs the side
 * effect. See {@link WorkspaceBackend} for the contract this implements.
 *
 * Constructed via {@link createLocalBackend}; the class itself is internal.
 */
class LocalBackend implements WorkspaceBackend {
  /** Read a file's full UTF-8 content at an absolute path. */
  public async readFile(absPath: string): Promise<string> {
    return fs.files.get(absPath);
  }

  /**
   * Write full content to an absolute path. Uses `atomicWriteAsync`, so a
   * concurrent reader never observes a half-written file, and missing parent
   * directories are created.
   */
  public async writeFile(absPath: string, content: string): Promise<void> {
    await fs.files.put(absPath, content, { atomic: true });
  }

  /** Whether anything (file or directory) exists at an absolute path. */
  public async exists(absPath: string): Promise<boolean> {
    return fs.exists(absPath);
  }

  /** Create a directory (and any missing parents) at an absolute path; idempotent. */
  public async mkdir(absPath: string): Promise<void> {
    await fs.dirs.ensure(absPath);
  }

  /**
   * Remove a file or directory tree at an absolute path. Stats the target to
   * pick the right op — `fs.dirs.remove` (recursive) for a directory,
   * `fs.files.remove` for anything else. A path that does not exist is a no-op
   * (the stat's ENOENT short-circuits, and both removes swallow `ENOENT`).
   */
  public async remove(absPath: string): Promise<void> {
    let isDirectory = false;

    try {
      isDirectory = (await fs.files.stats(absPath)).type === "directory";
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return;
      }

      throw error;
    }

    if (isDirectory) {
      await fs.dirs.remove(absPath);

      return;
    }

    await fs.files.remove(absPath);
  }

  /** List immediate children of an absolute directory as absolute paths. */
  public async list(absDir: string): Promise<string[]> {
    return fs.dirs.list(absDir);
  }

  /**
   * Describe a path without following a final symlink (`lstat` — like
   * `realpath`, a filesystem operation `@warlock.js/fs` does not expose).
   */
  public async stat(absPath: string): Promise<WorkspaceBackendStat> {
    const stats = await lstat(absPath);
    const type = stats.isSymbolicLink()
      ? "symlink"
      : stats.isDirectory()
        ? "directory"
        : stats.isFile()
          ? "file"
          : "other";

    return { type, size: stats.size };
  }

  /**
   * Resolve symlinks and `..` segments to a canonical absolute path — the
   * primitive the ops-layer jail uses to detect escapes. Delegates to
   * `node:fs/promises` `realpath`, the one filesystem operation `@warlock.js/fs`
   * does not expose.
   */
  public async realpath(absPath: string): Promise<string> {
    return realpath(absPath);
  }

  /**
   * Run a command and capture its outcome. In argv mode (the default) the
   * command line is tokenized into an argv (quotes respected, NO shell
   * semantics — see `tokenizeCommand`) and spawned **without a shell**, so
   * metacharacters like `;`, `&&`, `|`, backticks, and `$()` can never
   * chain extra commands past the ops layer's allowlist; a command they
   * appear unquoted in is refused with exit code 127. On Windows the argv
   * runs through a `cmd.exe /d /s /c` wrapper (batch shims like `npm.cmd`
   * cannot be spawned shell-less) with every element individually quoted.
   * With `interpreter: "sh"` the line runs through `/bin/sh -c` (or
   * `cmd.exe /d /v:off /s /c` on Windows) — only after the ops layer has
   * checked every command in it.
   * `cwd`, `env`, and the timeout are taken verbatim from the ops layer
   * (the environment is NOT merged with `process.env`). On timeout the
   * process tree is SIGKILLed and `timedOut` is set. When `signal` aborts
   * mid-run the process tree is SIGKILLed the same way and `cancelled` is
   * set; an already-aborted `signal` resolves `cancelled` without spawning.
   * `stdout`/`stderr` are captured and byte-capped per {@link MAX_STREAM_BYTES}.
   *
   * Never rejects for a non-zero exit, a missing executable, a refused
   * command line, a timeout or a cancellation — those are reported through the resolved
   * {@link WorkspaceBackendExecResult} so the ops layer can surface them
   * as tool-error data.
   */
  public exec(
    command: string,
    opts: WorkspaceBackendExecOptions = {},
  ): Promise<WorkspaceBackendExecResult> {
    return new Promise<WorkspaceBackendExecResult>((resolve) => {
      const refuse = (stderr: string): void =>
        resolve({ exitCode: 127, stdout: "", stderr, timedOut: false });

      const signal = opts.signal;

      // Never spawn for an invocation that was cancelled before it started.
      if (signal?.aborted) {
        resolve({
          exitCode: 130,
          stdout: "",
          stderr: "Command was not executed: the invocation was cancelled before it started.",
          timedOut: false,
          cancelled: true,
        });

        return;
      }

      const plan = planSpawn(command, opts.interpreter ?? "none");

      if ("refused" in plan) {
        refuse(plan.refused);

        return;
      }

      const child = spawn(plan.file, plan.args, {
        cwd: opts.cwd,
        env: opts.env,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: plan.windowsVerbatimArguments,
        // POSIX: own process group so a timeout SIGKILL reaps the whole
        // process tree, not just the direct child. Harmless on Windows
        // (ignored; there we tree-kill via taskkill instead).
        detached: platform !== "win32",
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      // The direct child has exited; 'close' may still be pending while its
      // stdio drains (or a grandchild holds the pipes open).
      let exited = false;

      // Timeout and cancellation are mutually exclusive: whichever kills the
      // tree first owns the outcome, so a result is never both.
      const timer =
        opts.timeoutMs !== undefined && opts.timeoutMs > 0
          ? setTimeout(() => {
              if (cancelled) {
                return;
              }

              timedOut = true;
              killTree(child.pid, child);
            }, opts.timeoutMs)
          : undefined;

      const onAbort = (): void => {
        if (settled || timedOut) {
          return;
        }

        // The command already finished: report its real outcome, not a
        // cancellation. Still reap the tree so a grandchild holding the
        // pipes open cannot keep `close` (and this promise) pending.
        if (!exited) {
          cancelled = true;
        }

        killTree(child.pid, child);
      };

      // Attached synchronously after `spawn`, so there is no window in which
      // an abort could be missed; removed in `settle` so a long-lived signal
      // shared across many commands does not accumulate listeners.
      signal?.addEventListener("abort", onAbort, { once: true });

      const settle = (exitCode: number) => {
        if (settled) {
          return;
        }

        settled = true;

        if (timer !== undefined) {
          clearTimeout(timer);
        }

        signal?.removeEventListener("abort", onAbort);

        resolve({
          exitCode,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          timedOut,
          cancelled,
        });
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBytes = pushCapped(stdoutChunks, stdoutBytes, chunk);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBytes = pushCapped(stderrChunks, stderrBytes, chunk);
      });

      // A spawn failure (e.g. the executable cannot be found) surfaces as
      // an error event with no exit; report it as a conventional
      // "command not found" exit code rather than rejecting.
      child.on("error", () => {
        settle(127);
      });

      child.on("exit", () => {
        exited = true;
      });

      child.on("close", (code, signal) => {
        // A null code means the process was terminated by a signal (our
        // timeout SIGKILL, or an external kill). Map that to the POSIX
        // 128 + signal-number convention so callers see a non-zero exit.
        if (code === null) {
          const signalNumber = signal === "SIGKILL" ? 9 : 1;
          settle(128 + signalNumber);

          return;
        }

        settle(code);
      });
    });
  }

  /**
   * Start a long-running command and return at once. Spawned like
   * {@link exec} (same argv/shell planning, own process group on POSIX), with
   * stdin closed. Output is decoded per stream with a `StringDecoder`, so a
   * chunk never ends inside a character. `kill()` kills the whole tree; a
   * still-running tree is also killed when the Node process exits.
   */
  public start(command: string, opts: WorkspaceBackendStartOptions): WorkspaceBackendProcess {
    const plan = planSpawn(command, opts.interpreter ?? "none");

    if ("refused" in plan) {
      opts.onOutput("stderr", plan.refused);

      return { done: Promise.resolve({ exitCode: 127 }), kill: () => {} };
    }

    const child = spawn(plan.file, plan.args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
      detached: platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let finished = false;

    const kill = (): void => {
      if (!finished) {
        killTree(child.pid, child);
      }
    };

    const untrack = trackBackgroundProcess(kill);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk);

      if (text !== "") {
        opts.onOutput("stdout", text);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk);

      if (text !== "") {
        opts.onOutput("stderr", text);
      }
    });

    const done = new Promise<{ exitCode: number }>((resolve) => {
      const finish = (exitCode: number): void => {
        if (finished) {
          return;
        }

        finished = true;
        untrack();

        const stdoutTail = stdoutDecoder.end();
        const stderrTail = stderrDecoder.end();

        if (stdoutTail !== "") {
          opts.onOutput("stdout", stdoutTail);
        }

        if (stderrTail !== "") {
          opts.onOutput("stderr", stderrTail);
        }

        resolve({ exitCode });
      };

      child.on("error", (error) => {
        opts.onOutput("stderr", `Command could not be started: ${error.message}`);
        finish(127);
      });

      child.on("close", (code, signal) => {
        finish(code === null ? 128 + (signal === "SIGKILL" ? 9 : 1) : code);
      });
    });

    return { ...(child.pid !== undefined ? { pid: child.pid } : {}), done, kill };
  }
}

/**
 * Create the **local** workspace backend — the default executor that runs the
 * workspace over the real disk (`@warlock.js/fs`) and the local shell
 * (`node:child_process`).
 *
 * The returned object is policy-agnostic: it expects already-jail-resolved
 * absolute paths and an already-resolved environment/timeout from the ops
 * layer. Pair it with {@link WorkspaceOps} for the actual cwd jail,
 * allow/deny lists, hashing, and output policy.
 *
 * @example
 * const backend = createLocalBackend();
 * await backend.writeFile("/srv/app/src/index.ts", "export const x = 1;");
 * const { exitCode } = await backend.exec("node -v", { cwd: "/srv/app" });
 */
export function createLocalBackend(): WorkspaceBackend {
  return new LocalBackend();
}
