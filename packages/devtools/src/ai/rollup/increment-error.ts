import type { DevtoolsAiRollupDelta } from "../types";

/**
 * Thrown by `DevtoolsAiRollupStore.increment` when only part of the deltas
 * were written. `unwritten` lists the deltas that were not saved, so the
 * writer retries those alone and never adds a saved delta twice. A store that
 * throws any other error is treated as having written nothing.
 */
export class DevtoolsAiRollupIncrementError extends Error {
  public readonly unwritten: readonly DevtoolsAiRollupDelta[];

  public constructor(
    unwritten: readonly DevtoolsAiRollupDelta[],
    options: { written: number; cause: unknown },
  ) {
    const reason = options.cause instanceof Error ? options.cause.message : String(options.cause);

    super(
      `${unwritten.length} of ${unwritten.length + options.written} AI totals were not saved (${reason})`,
      { cause: options.cause },
    );
    this.name = "DevtoolsAiRollupIncrementError";
    this.unwritten = unwritten;
  }
}
