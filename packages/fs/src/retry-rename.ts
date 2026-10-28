import { rename } from "node:fs/promises";
import { AtomicWriteError } from "./atomic-write-error";

/** Error codes considered a transient lock rather than a real failure. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Tuning knobs for {@link renameWithRetry}; both have sane defaults. */
export type RenameRetryOptions = {
  /** Total rename attempts before giving up. Defaults to 5. */
  attempts?: number;
  /** Delay before the second attempt, doubled on each subsequent retry. Defaults to 20ms. */
  initialDelayMs?: number;
  /** Upper bound for a single wait. Unbounded by default off Windows. */
  maxDelayMs?: number;
};

/**
 * Windows refuses to rename over a file another handle has open (a sharing
 * violation reported as EPERM / EACCES / EBUSY), and a reader polling the file
 * can keep it open for a while, so it retries for several seconds: 10 ms
 * doubling to a 150 ms cap, 30 attempts, about 4 s in total. Elsewhere a
 * rename over an open file just works, so the short schedule is unchanged.
 */
const IS_WINDOWS = process.platform === "win32";
const DEFAULT_ATTEMPTS = IS_WINDOWS ? 30 : 5;
const DEFAULT_INITIAL_DELAY_MS = IS_WINDOWS ? 10 : 20;
const DEFAULT_MAX_DELAY_MS = IS_WINDOWS ? 150 : Number.POSITIVE_INFINITY;

/** Waits between the attempts of a retry schedule (one fewer than `attempts`). */
export function renameRetryDelays(
  attempts: number,
  initialDelayMs: number,
  maxDelayMs: number,
): number[] {
  return Array.from({ length: Math.max(attempts - 1, 0) }, (_, index) =>
    Math.min(initialDelayMs * 2 ** index, maxDelayMs),
  );
}

function isRetryableRenameError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as NodeJS.ErrnoException).code === "string" &&
    RETRYABLE_CODES.has((error as NodeJS.ErrnoException).code as string)
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Rename `from` to `to`, retrying with bounded exponential backoff when the
 * OS reports a transient lock on the target (`EPERM` / `EBUSY` / `EACCES` —
 * routinely seen on Windows when antivirus or the search indexer briefly
 * holds a file open right after it's created). With the defaults, the 5
 * attempts and doubling 20ms delay cap total wait time under ~1s.
 *
 * Every other error is rethrown on the first attempt — retrying a
 * non-transient failure (e.g. `ENOSPC`) only delays reporting it. Never
 * falls back to a non-atomic write; exhausting all attempts throws
 * {@link AtomicWriteError} rather than writing the target directly.
 *
 * @example
 *   await renameWithRetry(tempPath, targetPath);
 */
export async function renameWithRetry(
  from: string,
  to: string,
  options: RenameRetryOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;

  const delays = renameRetryDelays(
    attempts,
    initialDelayMs,
    options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
  );
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      lastError = error;

      if (!isRetryableRenameError(error)) {
        throw error;
      }

      if (attempt < attempts) {
        await delay(delays[attempt - 1] ?? 0);
      }
    }
  }

  throw new AtomicWriteError(to, attempts, lastError);
}
