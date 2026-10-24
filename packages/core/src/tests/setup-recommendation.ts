/**
 * Decides whether a run spent enough of its time in per-file setup to be worth
 * recommending `tests.lifetime: "worker"`. Pure and import-free so the Vite
 * reporter and the worker summary share one rule.
 */
export type SetupShare = {
  /** Test files that ran setup. */
  files: number;
  /** Full framework boots. Equal to `files` under the default file lifetime. */
  bootstraps: number;
  /** Time spent booting, resetting and tearing down, in milliseconds. */
  setupMs: number;
  /** Time spent between setup finishing and teardown starting, in milliseconds. */
  bodyMs: number;
};

/** Setup must be at least this share of setup plus test time. */
export const SETUP_RECOMMENDATION_THRESHOLD = 0.5;

/** Fewer files than this cannot amortize anything worth mentioning. */
export const SETUP_RECOMMENDATION_MIN_FILES = 4;

/**
 * The advice line, or `undefined` when the run does not need any: the worker
 * lifetime is already in use, there are too few files, or setup is not dominant.
 */
export function recommendWorkerLifetime(share: SetupShare): string | undefined {
  if (share.files < SETUP_RECOMMENDATION_MIN_FILES) return undefined;
  // A worker lifetime boots once per worker, so fewer boots than files means it is on.
  if (share.bootstraps < share.files) return undefined;

  const total = share.setupMs + share.bodyMs;
  if (total <= 0) return undefined;

  const ratio = share.setupMs / total;
  if (ratio < SETUP_RECOMMENDATION_THRESHOLD) return undefined;

  return (
    `[warlock:test] setup took ${Math.round(ratio * 100)}% of the time spent in ${share.files} files ` +
    `(${share.bootstraps} full boots). Consider tests.lifetime: "worker" in src/config/tests.ts with ` +
    `isolate: false on the integration project, and tests.resetDatabase: true; ` +
    `see the "Opt into one runtime per fork" section of the testing guide.`
  );
}
