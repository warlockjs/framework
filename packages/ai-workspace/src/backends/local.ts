import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { platform } from "node:process";
import { fs } from "@warlock.js/fs";
import { tokenizeCommand } from "../policy/tokenize-command";
import type {
  WorkspaceBackend,
  WorkspaceBackendExecOptions,
  WorkspaceBackendExecResult,
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
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });

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
function toWin32CmdInvocation(
  argv: string[],
): { file: string; args: string[] } | null {
  if (argv.some((element) => WIN32_UNSAFE_ARGUMENT.test(element))) {
    return null;
  }

  const commandLine = argv.map((element) => `"${element}"`).join(" ");

  return {
    file: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${commandLine}"`],
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
   * Resolve symlinks and `..` segments to a canonical absolute path — the
   * primitive the ops-layer jail uses to detect escapes. Delegates to
   * `node:fs/promises` `realpath`, the one filesystem operation `@warlock.js/fs`
   * does not expose.
   */
  public async realpath(absPath: string): Promise<string> {
    return realpath(absPath);
  }

  /**
   * Run a command and capture its outcome. The command line is tokenized
   * into an argv (quotes respected, NO shell semantics — see
   * `tokenizeCommand`) and spawned **without a shell**, so metacharacters
   * like `;`, `&&`, `|`, backticks, and `$()` can never chain extra
   * commands past the ops layer's allowlist; a command they appear
   * unquoted in is refused with exit code 127. On Windows the argv runs
   * through a `cmd.exe /d /s /c` wrapper (batch shims like `npm.cmd`
   * cannot be spawned shell-less) with every element individually quoted.
   * `cwd`, `env`, and the timeout are taken verbatim from the ops layer
   * (the environment is NOT merged with `process.env`). On timeout the
   * process is SIGKILLed and `timedOut` is set. `stdout`/`stderr` are
   * captured and byte-capped per {@link MAX_STREAM_BYTES}.
   *
   * Never rejects for a non-zero exit, a missing executable, a refused
   * command line, or a timeout — those are reported through the resolved
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

      const argv = tokenizeCommand(command);

      if (argv === null) {
        refuse(
          "Command was not executed: it is empty, has unbalanced quotes, or " +
            "contains unquoted shell metacharacters (;, &, |, `, $, <, >, " +
            "parentheses). Commands run without a shell — pass metacharacters " +
            "inside quotes as literal arguments, or run one command at a time.",
        );

        return;
      }

      let file = argv[0];
      let args = argv.slice(1);
      let windowsVerbatimArguments = false;

      if (platform === "win32") {
        const invocation = toWin32CmdInvocation(argv);

        if (invocation === null) {
          refuse(
            'Command was not executed: on Windows, arguments containing ", %, ' +
              "or newlines cannot be passed to cmd.exe safely.",
          );

          return;
        }

        file = invocation.file;
        args = invocation.args;
        windowsVerbatimArguments = true;
      }

      const child = spawn(file, args, {
        cwd: opts.cwd,
        env: opts.env,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments,
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
      let settled = false;

      const timer =
        opts.timeoutMs !== undefined && opts.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              killTree(child.pid, child);
            }, opts.timeoutMs)
          : undefined;

      const settle = (exitCode: number) => {
        if (settled) {
          return;
        }

        settled = true;

        if (timer !== undefined) {
          clearTimeout(timer);
        }

        resolve({
          exitCode,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          timedOut,
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
