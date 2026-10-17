/**
 * The application clock.
 *
 * Read the current time through `clock` instead of `new Date()` / `Date.now()`
 * where a test needs to control it: tokens that expire, "created 5 minutes
 * ago", scheduled cut-offs. In the test environment the test kit swaps the
 * source for a frozen one (`clockFake` from `@warlock.js/core/tests`); in
 * every other environment it is the system clock.
 *
 * Only code that reads `clock` is affected — the global `Date` and timers are
 * never patched, so a fake clock cannot stall `setTimeout` or a driver.
 *
 * @example
 * import { clock } from "@warlock.js/core";
 *
 * const expiresAt = new Date(clock.timestamp() + 15 * 60_000);
 */
export type ClockSource = {
  /** Milliseconds since the Unix epoch. */
  now(): number;
};

const systemClock: ClockSource = { now: () => Date.now() };

// On `globalThis` so the framework loaded twice in one Vitest worker (native
// and through vite-node) still reads one source.
const SOURCE_KEY = Symbol.for("warlock.core.clockSource");

type SourceHolder = { [SOURCE_KEY]?: ClockSource };

function source(): ClockSource {
  return (globalThis as SourceHolder)[SOURCE_KEY] ?? systemClock;
}

export const clock = {
  /** The current time as a `Date`. */
  now(): Date {
    return new Date(source().now());
  },

  /** The current time in milliseconds since the Unix epoch. */
  timestamp(): number {
    return source().now();
  },
};

/**
 * Replace the clock's source, or restore the system clock with `undefined`.
 * The test kit's `clockFake` is built on this.
 */
export function setClockSource(next: ClockSource | undefined): void {
  (globalThis as SourceHolder)[SOURCE_KEY] = next;
}
