import { type ChildProcess, spawn } from "node:child_process";

/**
 * Terminate a CLI and everything it started.
 *
 * Coding CLIs spawn shells, language servers and MCP servers, so signalling
 * the direct child alone would leave grandchildren running.
 *
 * - **POSIX** — the child was spawned `detached` (its own process group), so
 *   the whole group gets `SIGTERM`, then `SIGKILL` after `graceMs`.
 * - **Windows** — `taskkill /T /F` walks and kills the PID's tree (console
 *   programs ignore a polite close, so there is no grace step).
 *
 * Only the tree this package spawned is ever signalled: the child's own PID
 * (Windows) or its own process group (POSIX) — never a name, port or
 * pattern. The SIGKILL follows even when the leader exits on SIGTERM, so a
 * grandchild that ignores SIGTERM (and keeps the pipes open) is still
 * reaped; a process group id cannot be reused while any member is alive.
 * Call the returned function once the session's pipes have closed (the
 * whole tree is gone) to cancel that pending SIGKILL.
 */
export function killProcessTree(
  child: ChildProcess,
  platform: NodeJS.Platform,
  graceMs: number,
): () => void {
  const pid = child.pid;

  if (pid === undefined) {
    child.kill("SIGKILL");

    return () => undefined;
  }

  if (platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });

    // A missing taskkill must not crash the process with an unhandled
    // 'error' event; fall back to the direct child.
    killer.on("error", () => {
      child.kill("SIGKILL");
    });

    return () => undefined;
  }

  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      process.kill(-pid, signal);
    } catch {
      // The group is already gone, or the child is not a group leader.
      try {
        child.kill(signal);
      } catch {
        // Already exited.
      }
    }
  };

  signalGroup("SIGTERM");

  const timer = setTimeout(() => signalGroup("SIGKILL"), Math.max(0, graceMs));

  timer.unref();

  return () => clearTimeout(timer);
}
