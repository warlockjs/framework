import { setClockSource } from "../../utils/clock";

/**
 * The instant the fake clock starts at: 2026-01-01T00:00:00.000Z. Fixed so a
 * snapshot or an expiry computed in a test is the same on every run.
 */
export const DEFAULT_FAKE_NOW = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

let now = DEFAULT_FAKE_NOW;
let installed = false;

function toTimestamp(value: Date | string | number): number {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    throw new RangeError(`clockFake cannot travel to ${JSON.stringify(value)}: not a valid date.`);
  }

  return timestamp;
}

/**
 * A frozen `clock` (from `@warlock.js/core`) that only moves when told to.
 *
 * Installed by default in the test environment, frozen at
 * {@link DEFAULT_FAKE_NOW}. It replaces only the framework clock: `Date`,
 * `setTimeout` and drivers keep real time, so nothing stalls.
 *
 * @example
 * const token = await issueResetToken(user); // expires in 15 minutes
 *
 * clockFake.travel(16 * 60_000);
 *
 * expect(await isResetTokenValid(token)).toBe(false);
 */
export const clockFake = {
  /** Freeze the clock at `at` (default {@link DEFAULT_FAKE_NOW}). */
  install(at: Date | string | number = DEFAULT_FAKE_NOW): void {
    now = toTimestamp(at);
    installed = true;
    setClockSource({ now: () => now });
  },

  /** Hand the clock back to real time. */
  restore(): void {
    installed = false;
    now = DEFAULT_FAKE_NOW;
    setClockSource(undefined);
  },

  isInstalled(): boolean {
    return installed;
  },

  /** Freeze at a given instant (installs the fake if needed). */
  freeze(at: Date | string | number = installed ? now : DEFAULT_FAKE_NOW): Date {
    clockFake.install(at);

    return new Date(now);
  },

  /** Move the frozen clock by `milliseconds` (negative goes back). */
  travel(milliseconds: number): Date {
    if (!installed) clockFake.install();

    now += milliseconds;

    return new Date(now);
  },

  /** Jump the frozen clock to an instant. */
  travelTo(at: Date | string | number): Date {
    return clockFake.freeze(at);
  },

  /** The fake clock's current time. */
  now(): Date {
    return new Date(now);
  },
};
