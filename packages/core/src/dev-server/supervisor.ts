import { spawn, type ChildProcess } from "node:child_process";
import { devLogError, devLogWarn } from "./dev-logger";

/**
 * Set on the worker process so it knows it was launched by a supervisor —
 * and so `warlock dev` inside the worker runs the server instead of
 * supervising a third process.
 */
export const WORKER_ENV_FLAG = "WARLOCK_DEV_WORKER";

/**
 * Exit code a worker uses to ask for a fresh process. Chosen as EX_TEMPFAIL,
 * whose conventional meaning ("temporary failure, retry") is close enough that
 * a stray supervisor-less exit reads sensibly in a shell.
 */
export const RESTART_EXIT_CODE = 75;

/** Signals the supervisor must hand to the worker rather than act on itself. */
const FORWARDED_SIGNALS: NodeJS.Signals[] = ["SIGTERM", "SIGHUP"];

/**
 * How long a worker must survive before an abnormal exit counts as a crash
 * worth recovering from rather than a failed boot worth reporting once.
 */
const HEALTHY_UPTIME_MS = 5_000;

/** Crashes allowed inside {@link CRASH_WINDOW_MS} before we stop restarting. */
const CRASH_RESTART_LIMIT = 3;

/** The rolling window flapping is measured over. */
const CRASH_WINDOW_MS = 60_000;

/** Whether this process is the worker (i.e. a supervisor already exists). */
export function isDevWorker(): boolean {
  return process.env[WORKER_ENV_FLAG] === "1";
}

/**
 * Run `warlock dev` as a supervised pair: a thin parent that owns the terminal
 * and a disposable child that is the actual dev server.
 *
 * The child asks to be replaced by exiting {@link RESTART_EXIT_CODE}; the
 * supervisor spawns a fresh one in its place. Because the parent is never
 * itself replaced, the process tree stays exactly two deep no matter how many
 * restarts happen — the previous design re-exec'd itself and left one idle
 * waiter behind per restart.
 *
 * The supervisor deliberately loads no config, no connectors, and no
 * application code, so a worker that wedges or dies can always be replaced by
 * a process that is known-good.
 *
 * Never resolves: the returned promise is a deliberate dead end so callers can
 * `return` it to stop everything downstream (notably the command's preloaders,
 * which must only ever run in the worker). The process ends with the last
 * worker, not with this promise.
 */
export function superviseDevServer(now: () => number = Date.now): Promise<never> {
  let worker: ChildProcess | undefined;
  let shuttingDown = false;
  let startedAt = 0;

  /** Timestamps of recent crash-restarts, used to detect flapping. */
  let crashes: number[] = [];

  const spawnWorker = (): void => {
    startedAt = now();

    worker = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      cwd: process.cwd(),
      env: { ...process.env, [WORKER_ENV_FLAG]: "1" },
      stdio: "inherit",
      windowsHide: false,
    });

    worker.on("error", (error) => {
      shuttingDown = true;
      devLogError(`Could not start the development server: ${error.message}`);
      process.exit(1);
    });

    worker.on("exit", (code, signal) => {
      releaseTerminal();

      // `return` after every exit deliberately: `process.exit` is typed
      // `never`, but treating it as control flow means anything that stubs it
      // out turns "we are shutting down" into "spawn another worker".
      if (shuttingDown) {
        process.exit(signal ? 1 : (code ?? 0));
        return;
      }

      if (code === RESTART_EXIT_CODE) {
        spawnWorker();
        return;
      }

      const crashed = signal !== null || (code ?? 0) !== 0;

      if (crashed && shouldRecoverFromCrash(now() - startedAt)) {
        devLogWarn(
          `Development server ${signal ? `was killed by ${signal}` : `exited with code ${code}`} — restarting.`,
        );
        spawnWorker();
        return;
      }

      // The worker owns its own error reporting; the supervisor only mirrors
      // the outcome so `npm run dev` and CI see the code they expect.
      process.exit(signal ? 1 : (code ?? 0));
    });
  };

  /**
   * Whether a worker that died on its own should be replaced.
   *
   * The rule is minimum healthy uptime, not a bare retry count. A worker that
   * dies almost immediately failed to *boot* — a broken config, a port already
   * taken — and it has already printed why; respawning would just reprint the
   * same error and bury it. A worker that ran fine for a while and then died
   * (OOM, a native crash, a dead loader thread) is the case worth recovering,
   * because the state that killed it is usually not reproduced on a fresh boot.
   *
   * Flapping is still capped: enough crashes inside one window and we stop and
   * say so, rather than restarting forever behind the developer's back.
   */
  function shouldRecoverFromCrash(uptimeMs: number): boolean {
    if (uptimeMs < HEALTHY_UPTIME_MS) {
      return false;
    }

    const at = now();

    crashes = [...crashes.filter((time) => at - time < CRASH_WINDOW_MS), at];

    if (crashes.length > CRASH_RESTART_LIMIT) {
      devLogError(
        `Development server crashed ${crashes.length} times in ` +
          `${Math.round(CRASH_WINDOW_MS / 1000)}s — not restarting again. ` +
          `Fix the cause and run \`warlock dev\` when you're ready.`,
      );
      return false;
    }

    return true;
  }

  // SIGINT reaches the worker directly from the terminal (same process group),
  // so the supervisor must NOT act on it — exiting here would orphan a server
  // that is still draining. It only notes that the next exit is final.
  process.on("SIGINT", () => {
    shuttingDown = true;
  });

  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, () => {
      shuttingDown = true;
      worker?.kill(signal);
    });
  }

  spawnWorker();

  return new Promise<never>(() => {
    // Intentionally never settles — see the doc comment.
  });
}

/**
 * Put the shared TTY back into a sane state after a worker exits.
 *
 * The worker takes stdin into raw mode for its keyboard shortcuts and releases
 * it on shutdown — but a worker that was killed outright never got the chance,
 * and the mode belongs to the terminal, not the process that set it. Without
 * this, the next worker (or the user's shell) inherits a stdin with no line
 * editing and no Ctrl+C.
 */
function releaseTerminal(): void {
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  } catch {
    // Nothing to recover if the terminal is already gone.
  }
}
