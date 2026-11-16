/**
 * Collecting a release: `warlock grimoire release <release>` gathers the
 * changelog entries of every feature into `grimoire/releases/<release>.md`,
 * between the collected-list markers, under the agent's brief.
 *
 * Which entries: only the entries under a `## <release> (<date>)` section of
 * a feature changelog (`state: "stamped"`). Entries still under
 * `## Unreleased` are never collected; the command reports them as a note.
 * Running it again rebuilds the same list, so nothing is listed twice.
 * Warlock never edits a feature changelog: the agent moves the entries under
 * the release section, and the check reports a listed entry with no matching
 * release and date (`GR6001`).
 */
import type { SourceLocation } from "./location";
import type { ChangeWord, CriterionId, FeatureVersion } from "./written";

/** One entry of a collected release. */
export type ReleaseEntry = {
  feature: string;
  version: FeatureVersion;
  word: ChangeWord;
  flow: string | null;
  criteria: CriterionId[];
  text: string;
  state: "stamped" | "unreleased";
  /** The changelog line. */
  source: SourceLocation;
};

/** The collected list of one release. */
export type ReleaseCollection = {
  release: string;
  /** The release file's `date`. */
  date: string;
  /** By feature id, then newest version first, in changelog order. */
  entries: ReleaseEntry[];
};

/**
 * The Markdown written between the markers (`renderCollectedList`):
 *
 * ```md
 * <!-- grimoire:collected:start -->
 * ## Changes
 *
 * ### catalog
 * - 2.1  fixed  new-arrivals: a customer with no country saw an empty list (AC-2)
 *
 * ### orders
 * - 3.0  added  pay-later: customers can pay within 14 days
 * <!-- grimoire:collected:end -->
 * ```
 *
 * The line grammar is the changelog entry grammar, so the check can read the
 * list back (`WrittenRelease.collected`). With no entries the list says
 * `No feature changes.`.
 */
export type CollectedListText = string;

/** What `writeRelease()` did. */
export type WriteReleaseResult = {
  /** `grimoire/releases/<release>.md`. */
  file: string;
  collection: ReleaseCollection;
  /** `false` when the file already held this exact list. */
  changed: boolean;
};
