/**
 * Everything a question needs, loaded once: the written files, the book, the
 * owners, the book maps, the proofs and the test results. `openGrimoire()`
 * builds it; `checkGrimoire()`, `scry()` and the devtools panel read it.
 */
import type { BookHost, BookMobileApp, BookSite } from "./adapter";
import type { BookAnnotations, LoadedBook } from "./book";
import type { CollectedFiles, Ownership } from "./bookmap";
import type { GrimoireFinding, RouteFreshness } from "./findings";
import type { GrimoireSettings } from "./settings";
import type { ShotsState } from "./shots";
import type { ProofLine, TestResultsStore } from "./test-results";
import type { WrittenGrimoire } from "./written";

export type GrimoireSnapshot = {
  /** Absolute project root. */
  root: string;
  written: WrittenGrimoire;
  /** Structure errors (`GR1xxx`) from parsing the written files. */
  structure: GrimoireFinding[];
  book: LoadedBook;
  ownership: Ownership;
  /** Written apps matched to the sites and mobile apps the adapter reports, by app id. */
  apps: Record<string, AppMatch>;
  proofs: ProofLine[];
  /** `GR4003`–`GR4005` findings from reading the `@proves` lines. */
  proofFindings: GrimoireFinding[];
  /** `null` when no test run has written results. */
  results: TestResultsStore | null;
  /**
   * Project-relative path the results were read from (or would be): the
   * `testResultsFile` option, else `grimoire/book/test-results.json`.
   */
  resultsFile: string;
  collected: CollectedFiles;
  annotations: BookAnnotations;
  routes: RouteFreshness;
  /**
   * Set only by the read-only open (`openStoredGrimoire`): the code, test and
   * written files that changed since the last build. The snapshot is the
   * stored one; `scry` says so in a note.
   */
  behind?: { changed: number };
  /** What the adapter's `host()` reported (framework brand, app name and version); `null` or absent when it reports none. */
  host?: BookHost | null;
  /**
   * `grimoire/settings.md` with its defaults, and the adapter's languages when
   * the file names none. Absent in snapshots made before 5.64; readers use
   * `DEFAULT_GRIMOIRE_SETTINGS` then.
   */
  settings?: GrimoireSettings;
  /** `@shows` lines, captures, the approved baseline and the drift from it. Absent when not loaded. */
  shots?: ShotsState;
};

/** Options of `openGrimoire()`. */
export type OpenGrimoireOptions = {
  /** See `BuildBookOptions.routes`. Default `cached`. */
  routes?: "fresh" | "cached";
  /** Write the book and the collected files (default `true`). `false` computes in memory only. */
  write?: boolean;
  /** Rebuild every book entry. */
  force?: boolean;
  /**
   * Where to read the test results from: a project-relative or absolute path.
   * Default `grimoire/book/test-results.json` (what the Vitest reporter
   * writes). A deploy that ships results from CI points here.
   */
  testResultsFile?: string;
  now?: () => Date;
};

/** A check rule: reads the snapshot, returns findings. Never writes. */
export type GrimoireRule = (snapshot: GrimoireSnapshot) => GrimoireFinding[];

/**
 * A written app (`grimoire/apps/<id>`) matched by its `root` to what the
 * adapter reports: a `site` app to a `BookSite` with the same root, a
 * `mobile` app to a `BookMobileApp` with the same root. `null` when nothing
 * matches (`GR5005`).
 */
export type AppMatch = {
  app: string;
  type: "site" | "mobile";
  site: BookSite | null;
  mobile: BookMobileApp | null;
};
