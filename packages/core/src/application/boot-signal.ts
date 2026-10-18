import type { Environment, RuntimeStrategy } from "../utils/environment";

/**
 * The only message type the boot channel carries today. Named rather than
 * inlined because both the sender (`sendBootSignal`) and the receiver
 * (`warlock start`) must agree on the exact literal.
 */
export type BootSignalType = "warlock:ready";

/**
 * Schema version of {@link BootSignal}.
 *
 * Present from the first release on purpose: a version field cannot be added to
 * a shipped wire format without a flag day, and this one has to be able to
 * evolve while older CLIs are still supervising newer bundles.
 */
export const BOOT_SIGNAL_VERSION = 1;

/**
 * What a booted child process tells its supervising parent over the IPC
 * channel `warlock start` opens for it.
 *
 * This is a wire contract, not an internal detail: `warlock start` prints its
 * success banner **only** when this arrives, so anything watching that banner
 * (a CI gate, a process supervisor) transitively depends on it.
 */
export type BootSignal = {
  type: BootSignalType;
  version: number;
  /** The application process, so a supervisor can address it directly. */
  pid: number;
  /** When the boot completed, ISO-8601. */
  at: string;
  environment: Environment;
  runtimeStrategy: RuntimeStrategy;
  bootDurationMs?: number;
  /** The bound http port, absent for an app with no http connector. */
  port?: number;
  /** The roles this process serves — see `Application.roles`. */
  roles: string[];
};

/**
 * Environment flag `warlock start` sets on the process it supervises.
 *
 * An IPC channel alone is NOT proof that the parent speaks this protocol —
 * a vitest worker fork or a custom supervisor may hand their child a
 * channel they use for their own messages. Writing to one of those, and then
 * closing it, corrupts someone else's protocol and can kill the process. The
 * flag is the handshake: only a parent that set it gets signalled.
 */
export const BOOT_SIGNAL_ENV_KEY = "WARLOCK_BOOT_SIGNAL";

/**
 * Report a completed boot to the parent process, if one is supervising.
 *
 * The versioned signal requires an IPC channel (`process.send` exists) and
 * the parent's {@link BOOT_SIGNAL_ENV_KEY} handshake. With IPC and `pm_id`,
 * PM2 instead receives its documented `"ready"` message and keeps its channel
 * open for logs and worker coordination.
 * Standalone bundles and unrecognized supervisors remain silent.
 *
 * The `warlock start` channel is closed as soon as its message is flushed.
 * An open IPC channel holds a `ref` on the child's event loop, keeping a finished or
 * wedged process alive and indistinguishable from a healthy server — the exact
 * confusion this signal exists to remove. One message, then disconnect.
 *
 * Failure to send is deliberately swallowed: the parent may have already
 * detached or died, and a supervisor going away must never take down a
 * healthy application.
 */
export function sendBootSignal(signal: BootSignal): void {
  if (typeof process.send !== "function") {
    return;
  }

  // PM2 injects pm_id (including "0") in both fork and cluster mode. Its
  // ProcessContainer uses this channel for logs too: never disconnect it.
  // https://github.com/Unitech/pm2/blob/master/lib/ProcessContainer.js
  // https://pm2.keymetrics.io/docs/usage/signals-clean-restart/
  if (process.env[BOOT_SIGNAL_ENV_KEY] !== "1") {
    if (process.env.pm_id !== undefined) {
      try {
        process.send("ready", undefined, undefined, () => {});
      } catch {
        // A detached supervisor must not take down an already booted app.
      }
    }
    return;
  }

  // Consumed here so it cannot be inherited by anything this app itself spawns
  // and make a grandchild report readiness on a channel meant for someone else.
  delete process.env[BOOT_SIGNAL_ENV_KEY];

  try {
    process.send(signal, undefined, undefined, () => {
      process.disconnect?.();
    });
  } catch {
    // The channel closed between the check and the write — the app is up
    // regardless, and there is no longer anyone to tell.
  }
}

/**
 * Narrow an arbitrary IPC payload to a {@link BootSignal}.
 *
 * The parent receives whatever the child chooses to send, so the message is
 * untrusted input and is validated before it is allowed to flip the parent's
 * "the server is up" state. A *newer* version than this CLI knows is still
 * accepted — readiness is readiness, and refusing it would make an old
 * supervisor report a healthy app as failed.
 */
export function isBootSignal(message: unknown): message is BootSignal {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const candidate = message as { type?: unknown; version?: unknown };

  return candidate.type === "warlock:ready" && typeof candidate.version === "number";
}
