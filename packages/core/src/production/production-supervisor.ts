import { spawn } from "child_process";
import { BOOT_SIGNAL_ENV_KEY, isBootSignal } from "../application/boot-signal";
import {
  displayMissingReadinessNotice,
  displayProductionReadyBanner,
  displayProductionStartFailure,
} from "../cli/cli-commands.utils";

/**
 * How long a still-running child may stay silent before we say so.
 *
 * Only reached by a bundle built before readiness reporting existed; a current
 * bundle signals as soon as its late-phase connectors are up.
 */
export const DEFAULT_READINESS_NOTICE_DELAY_MS = 10_000;

export type ProductionSupervisorOptions = {
  /** Arguments handed to the node binary, entry file included. */
  nodeArgs: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  readinessNoticeDelayMs?: number;
};

export type ProductionSupervisorResult = {
  /** What the CLI should exit with — never 0 for a boot that never completed. */
  exitCode: number;
  /** Whether the child ever reported a finished boot. */
  ready: boolean;
};

/**
 * Run the production bundle in a child process and report honestly on it.
 *
 * The supervisor exists because a parent with `stdio: "inherit"` cannot see
 * whether its child ever booted — it only sees the process exit. It therefore
 * opens an IPC channel and treats the child's `warlock:ready` signal, emitted
 * by `Application.markBooted`, as the single source of truth for "started":
 *
 * 1. The success banner is printed only on that signal.
 * 2. A child that dies before signalling is reported as a failed start and
 *    forced to a non-zero exit, even if it exited 0.
 * 3. A child still running without having signalled draws a note on stderr —
 *    never stdout, which would be the false-green this whole channel prevents.
 *
 * Resolves rather than exiting so the outcome stays assertable in a test; the
 * `start` command turns the result into the process exit code.
 */
export function superviseProductionProcess({
  nodeArgs,
  cwd = process.cwd(),
  env = process.env,
  readinessNoticeDelayMs = DEFAULT_READINESS_NOTICE_DELAY_MS,
}: ProductionSupervisorOptions): Promise<ProductionSupervisorResult> {
  return new Promise<ProductionSupervisorResult>((resolve) => {
    // On Windows, we need to be careful with signals - the console sends Ctrl+C
    // to all processes in the group, so we just need to not interfere.
    // `process.execPath`, not "node": the bare name needs `node` on PATH, which
    // a systemd unit, a cron job, or a slim container may not provide — and a
    // PATH `node` that *is* present can be a different version than the one
    // running this CLI. execPath is the binary already executing us.
    //
    // The fourth stdio slot opens the IPC channel the child reports readiness
    // on. Without it `process.send` is undefined in the child and we would be
    // back to guessing whether the boot succeeded.
    const child = spawn(process.execPath, nodeArgs, {
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      cwd,
      // The flag identifies us as a parent that speaks the boot protocol. The
      // child stays silent without it, so an app running under pm2 or any other
      // supervisor never writes to a channel that belongs to someone else.
      env: { ...env, [BOOT_SIGNAL_ENV_KEY]: "1" },
      // Important: keep child in same process group for proper signal handling
      detached: false,
    });

    const startedAt = Date.now();
    let isReady = false;
    let isShuttingDown = false;
    let isSettled = false;

    const readinessNoticeTimer = setTimeout(() => {
      if (isReady) {
        return;
      }

      displayMissingReadinessNotice(Date.now() - startedAt);
    }, readinessNoticeDelayMs);

    // A diagnostic timer must never be the reason the CLI stays alive.
    readinessNoticeTimer.unref?.();

    const settle = (result: ProductionSupervisorResult) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      clearTimeout(readinessNoticeTimer);
      process.off("SIGTERM", onSigterm);
      process.off("SIGINT", onSigint);

      resolve(result);
    };

    child.on("message", (message: unknown) => {
      if (isReady || !isBootSignal(message)) {
        return;
      }

      isReady = true;
      clearTimeout(readinessNoticeTimer);

      displayProductionReadyBanner({ bootDurationMs: message.bootDurationMs }).catch((error) => {
        // The server is up either way — a banner that fails to render must not
        // be reported as, or turn into, a boot failure.
        console.error(error);
      });
    });

    // A spawn that never starts (missing binary, EACCES) emits `error` and no
    // `exit`, so without this the command would hang silently on a failure.
    child.on("error", (error) => {
      displayProductionStartFailure(1);
      console.error(error);

      settle({ exitCode: 1, ready: false });
    });

    // SIGTERM doesn't auto-propagate like SIGINT does on Windows.
    const onSigterm = () => {
      if (isShuttingDown) {
        return;
      }

      isShuttingDown = true;
      child.kill("SIGTERM");
    };

    // On Windows Ctrl+C reaches both processes, so the child already has it —
    // we only record that this exit was asked for.
    const onSigint = () => {
      isShuttingDown = true;
    };

    process.on("SIGTERM", onSigterm);
    process.on("SIGINT", onSigint);

    child.on("exit", (code) => {
      // A child that dies before reporting readiness never served a request.
      // Exiting 0 there — which a clean `process.exit(0)` in failing app code
      // would do — reports a boot failure as a successful run, so the exit code
      // is forced non-zero to match what actually happened.
      //
      // An operator who interrupts the boot is not a failed boot, so a signalled
      // shutdown keeps the child's own exit code.
      if (!isReady && !isShuttingDown) {
        const exitCode = code === 0 || code === null ? 1 : code;

        displayProductionStartFailure(exitCode);

        return settle({ exitCode, ready: false });
      }

      settle({ exitCode: code ?? 0, ready: isReady });
    });
  });
}
