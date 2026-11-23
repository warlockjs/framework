/**
 * Visual proof: `@shows` scenes, the screenshots they capture per language,
 * the approved baseline, and what changed since it was approved.
 *
 * A browser test shows a criterion with a comment line directly above a
 * `shows()` call that names the same criterion:
 *
 * ```ts
 * // @shows contact/send-message AC-2
 * await shows(context, "contact/send-message AC-2", async ({ page, path }) => { … });
 * ```
 *
 * The scene runs once per language of the app; each run saves one
 * screenshot. Layout on disk (paths under `grimoire/screenshots/`):
 * - `captured/<feature>/<flow>/<AC-n>.<language>.png`: the last capture (Warlock, ignored by git);
 * - `captured/index.json`: {@link ShotCaptureIndex} (Warlock, ignored by git);
 * - `approved/<feature>/<flow>/<AC-n>.<language>.png`: the approved image (written only by approve, in git).
 *
 * `grimoire/approved/baseline.json` ({@link ApprovedBaseline}) is the
 * approved state of the flows, criteria, cases, proving tests and images;
 * {@link DriftItem}s are the differences from it. A project with no
 * language writes no `.<language>` part.
 */
import type { GrimoireFinding } from "./findings";
import type { SourceLocation } from "./location";
import type { ScreenshotMode } from "./settings";
import type { CriterionId, FlowRef } from "./written";

/** One `// @shows <feature>/<flow> AC-<n>` line, as the scanner reads it. */
export type ShowsLine = {
  feature: string;
  flow: string;
  ref: FlowRef;
  criterion: CriterionId;
  /** The `shows(…)` call right under the comment, or `null` when there is none (`GR4013`). */
  call: { line: number } | null;
  at: SourceLocation;
};

/** The result of one scene in one language. */
export type ShotOutcome = "pass" | "fail";

/** One capture: a scene run in one language. */
export type ShotCapture = {
  ref: FlowRef;
  criterion: CriterionId;
  /** The language the scene ran in; `""` when the app names no language. */
  language: string;
  /** Path under `grimoire/screenshots/` (`captured/contact/send-message/AC-2.ar.png`), or `null` when the scene failed before the capture. */
  file: string | null;
  /** sha256 of the PNG bytes, or `null` with `file`. */
  sha256: string | null;
  outcome: ShotOutcome;
  /** The scene's error message when it failed, else `null`. */
  error: string | null;
  viewport: { name: string; width: number; height: number };
  /** Project-relative browser test file. */
  spec: string;
  /** ISO time of the run. */
  ranAt: string;
};

/**
 * `grimoire/screenshots/captured/index.json`. A run replaces the captures of
 * the criteria and languages it ran and keeps the others, so a `changed` run
 * never forgets the rest.
 */
export type ShotCaptureIndex = {
  schemaVersion: 1;
  updatedAt: string;
  captures: ShotCapture[];
};

/** One approved image. */
export type ApprovedShot = {
  ref: FlowRef;
  criterion: CriterionId;
  language: string;
  /** Path under `grimoire/screenshots/` (`approved/contact/send-message/AC-2.ar.png`). */
  file: string;
  sha256: string;
  approvedAt: string;
};

/** The approved shape of one flow. */
export type ApprovedFlow = {
  ref: FlowRef;
  criteria: { id: CriterionId; text: string }[];
  /** Case questions written under `## Cases`, lower-case. */
  cases: string[];
};

/** The approved proving tests (`@proves` lines with their test names). */
export type ApprovedProof = {
  ref: FlowRef;
  criterion: CriterionId;
  /** Project-relative test file. */
  testFile: string;
  testName: string | null;
};

/** A change the owner rejected: it stays an error (`GR4019`) until the code no longer has it. */
export type RejectedChange = {
  /** The {@link DriftItem} id. */
  id: string;
  rejectedAt: string;
  /** Why, in the owner's words, or `null`. */
  note: string | null;
};

/**
 * `grimoire/approved/baseline.json`, in git. Written only by
 * `warlock grimoire approve` / `reject` and the tab's Approve and Reject
 * buttons; never by an agent.
 */
export type ApprovedBaseline = {
  schemaVersion: 1;
  /** ISO time of the last approval. */
  approvedAt: string;
  flows: ApprovedFlow[];
  proofs: ApprovedProof[];
  shots: ApprovedShot[];
  rejected: RejectedChange[];
};

/** What changed since the approval. */
export type DriftType =
  | "shot-changed"
  | "shot-added"
  | "shot-removed"
  | "flow-added"
  | "flow-removed"
  | "criterion-added"
  | "criterion-removed"
  | "criterion-changed"
  | "case-added"
  | "case-removed"
  | "proof-removed";

/** One difference from the approved baseline: "changed, not approved" in the bird-view. */
export type DriftItem = {
  /**
   * Stable id, what approve and reject take:
   * `<type>:<feature>/<flow>[:<AC-n>][:<language>|:<case>]`
   * (`shot-changed:contact/send-message:AC-2:ar`).
   */
  id: string;
  type: DriftType;
  ref: FlowRef;
  criterion: CriterionId | null;
  /** For shot items; `""` when the app names no language. */
  language: string | null;
  /** For case items: the case question. */
  case: string | null;
  /** The approved text (a criterion's text, a test name), or `null`. */
  before: string | null;
  /** The text now, or `null` when removed. */
  after: string | null;
  /** For shot items: the approved and the captured image, paths under `grimoire/screenshots/`. */
  approvedShot: string | null;
  capturedShot: string | null;
  /** Set when the owner rejected this change. */
  rejected: RejectedChange | null;
};

/** Everything about visual proof that a snapshot carries (`GrimoireSnapshot.shots`). */
export type ShotsState = {
  mode: ScreenshotMode;
  shows: ShowsLine[];
  /** `GR4013` / `GR4014` findings from reading the `@shows` lines. */
  showsFindings: GrimoireFinding[];
  /** `null` when no scene ever ran. */
  captures: ShotCaptureIndex | null;
  /** `null` until the first approval. */
  baseline: ApprovedBaseline | null;
  /** Empty while `baseline` is `null`. */
  drift: DriftItem[];
  /** Flows whose front matter says `screenshots: false`. */
  optedOut: FlowRef[];
};
