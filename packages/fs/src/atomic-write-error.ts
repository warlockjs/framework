/**
 * Thrown when {@link renameWithRetry} (see `retry-rename.ts`) exhausts every
 * retry attempt trying to rename an atomic write's temp file onto its
 * target — e.g. Windows antivirus or the search indexer holding the target
 * open (`EPERM` / `EBUSY` / `EACCES`) for longer than the backoff window.
 *
 * Carries the target path and attempt count so callers can log a precise
 * diagnosis without parsing the message; the last OS error is attached as
 * `cause`.
 */
export class AtomicWriteError extends Error {
  public constructor(
    public readonly targetPath: string,
    public readonly attempts: number,
    cause: unknown,
  ) {
    const causeCode =
      cause instanceof Error && "code" in cause
        ? ` (${String((cause as NodeJS.ErrnoException).code)})`
        : "";
    const attemptWord = attempts === 1 ? "attempt" : "attempts";

    super(
      `Failed to atomically write "${targetPath}" after ${attempts} ${attemptWord}${causeCode}`,
      { cause },
    );
    this.name = "AtomicWriteError";
  }
}
