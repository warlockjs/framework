/**
 * The bird-view: one matrix of every feature, flow and acceptance criterion
 * against the app's languages (`GET /matrix` of the Grimoire tab, the
 * "Bird view" tab). Built from the snapshot; without screenshots or a
 * baseline it shows the test status only.
 */
import type { DriftItem } from "./shots";
import type { ScreenshotMode } from "./settings";
import type { CriterionStatus } from "./test-results";
import type { CriterionId, FlowRef, WrittenStatus } from "./written";

/** The colour of a cell, worst first: a rejected change, a failure, a change not approved, then the test states. */
export type MatrixCellState =
  | "rejected"
  | "fail"
  | "changed"
  | "stale"
  | "not-run"
  | "no-test"
  | "pass";

/** One criterion in one language. */
export type MatrixCell = {
  /** `""` when the app names no language (one column). */
  language: string;
  /** The criterion's `@proves` tests; the same in every language. */
  test: CriterionStatus;
  /** The criterion's `@shows` scene in this language, or `null` when it has none. */
  shown: {
    outcome: "pass" | "fail" | "not-run";
    /** The captured image, a path under `grimoire/screenshots/`, or `null`. */
    shot: string | null;
    /** The approved image, or `null`. */
    approved: string | null;
    ranAt: string | null;
  } | null;
  /** `null` when there is no baseline yet. */
  approval: "approved" | "changed" | "rejected" | null;
  /** Ids of the drift items about this cell (open them side by side). */
  drift: string[];
  state: MatrixCellState;
};

export type MatrixCriterionRow = {
  id: CriterionId;
  text: string;
  /** The app the criterion is scoped to (`AC-n [app]`), or `null` for every app. */
  app: string | null;
  /** `true` for a criterion of the baseline that is no longer written. */
  removed: boolean;
  cells: MatrixCell[];
};

export type MatrixFlowRow = {
  ref: FlowRef;
  id: string;
  title: string;
  status: WrittenStatus | null;
  /** Apps named under `## Differs by app`. */
  differsIn: string[];
  /** `false` when the flow opted out with `screenshots: false`. */
  screenshots: boolean;
  removed: boolean;
  criteria: MatrixCriterionRow[];
  /** Drift ids of the flow itself (added, removed, case and proof changes). */
  drift: string[];
};

export type MatrixFeatureRow = {
  id: string;
  title: string;
  /** `true` for the `design-system` feature, listed first. */
  designSystem: boolean;
  flows: MatrixFlowRow[];
};

/** `GET /matrix`. */
export type GrimoireMatrix = {
  /** The columns: the app's languages, or `[""]` when it names none. */
  languages: string[];
  mode: ScreenshotMode;
  /** `null` until the first approval. */
  baseline: { approvedAt: string } | null;
  features: MatrixFeatureRow[];
  /** Every drift item, for the side-by-side panel. */
  drift: DriftItem[];
  /** Cells per state, over every criterion and language. */
  counts: Record<MatrixCellState, number>;
};
