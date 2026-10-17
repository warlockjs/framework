import { setIdsSource } from "../../utils/ids";

let uuidSequence = 0;
let tokenSequence = 0;
let installed = false;

/** `00000000-0000-4000-8000-000000000001` for 1: a valid v4-shaped UUID. */
function sequentialUuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

/** `token0001token0001…` cut to `length`: URL-safe and readable in a diff. */
function sequentialToken(value: number, length: number): string {
  const unit = `token${String(value).padStart(4, "0")}`;

  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

/**
 * Deterministic `ids` (from `@warlock.js/core`): numbered UUIDs and tokens.
 *
 * Installed by default in the test environment. Each sequence restarts on
 * install and on `reset()`, so the n-th id in a test is the same on every run.
 *
 * @example
 * const file = await storeReport(report); // named ids.uuid() + ".pdf"
 *
 * expect(file.path).toBe("reports/00000000-0000-4000-8000-000000000001.pdf");
 */
export const idsFake = {
  install(): void {
    installed = true;
    idsFake.reset();
    setIdsSource({
      uuid: () => sequentialUuid(++uuidSequence),
      token: (length) => sequentialToken(++tokenSequence, length),
    });
  },

  restore(): void {
    installed = false;
    idsFake.reset();
    setIdsSource(undefined);
  },

  isInstalled(): boolean {
    return installed;
  },

  /** Restart both sequences. */
  reset(): void {
    uuidSequence = 0;
    tokenSequence = 0;
  },

  /** The UUID the n-th `ids.uuid()` call returns (1-based). */
  uuid(n: number): string {
    return sequentialUuid(n);
  },
};
