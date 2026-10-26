/**
 * Raised when a bounded step does not settle in time. The step itself is NOT
 * cancelled (a driver call cannot be); the caller is expected to close the
 * connection, which aborts whatever the server is still doing for it.
 */
export class StepTimeoutError extends Error {
  public readonly type = "step-timeout";

  public constructor(
    message: string,
    public readonly timeoutMs: number,
  ) {
    super(message);
    this.name = "StepTimeoutError";
  }
}

/**
 * Settle with `promise`, or reject with a {@link StepTimeoutError} carrying
 * `describe()` once `timeoutMs` has elapsed. `timeoutMs <= 0` (or not finite)
 * disables the bound. The timer never keeps the process alive.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  describe: () => string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeoutError(describe(), timeoutMs)), timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    // The losing promise may reject later; that must not surface as unhandled.
    promise.catch(() => undefined);
  }
}
