/**
 * Thrown when the `bullmq` queue driver (`bullmqQueue()`) is configured but
 * `@warlock.js/queue` — an optional peer — isn't installed. Surfaced at USE
 * time (first `.queue()` call), not at boot, matching the lazy-optional-peer
 * pattern `loadHerald` already uses for `@warlock.js/herald`.
 */

function captureStack(target: object, ctor: new (...args: any[]) => unknown): void {
  // V8 only; guarded for non-V8 runtimes.
  (Error as unknown as { captureStackTrace?: (t: object, c: unknown) => void }).captureStackTrace?.(
    target,
    ctor,
  );
}

export class QueuePackageNotInstalledError extends Error {
  public constructor() {
    super(
      "The bullmq notifications queue driver requires @warlock.js/queue, which isn't installed. " +
        "Install it with:\n\n" +
        "  warlock add queue\n\n" +
        "Or with your preferred package manager:\n\n" +
        "  pnpm add @warlock.js/queue\n" +
        "  npm install @warlock.js/queue\n" +
        "  yarn add @warlock.js/queue",
    );
    this.name = "QueuePackageNotInstalledError";
    captureStack(this, QueuePackageNotInstalledError);
  }
}
