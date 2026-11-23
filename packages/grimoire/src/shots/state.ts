/**
 * What a snapshot carries about visual proof (`GrimoireSnapshot.shots`):
 * the `@shows` lines, the captures, the approved baseline and the drift.
 */
import type { GrimoireFinding } from "../contracts/findings";
import type { GrimoireSettings } from "../contracts/settings";
import type { ShotsState } from "../contracts/shots";
import type { ProofLine } from "../contracts/test-results";
import type { WrittenGrimoire } from "../contracts/written";
import { scanShows } from "../proves/scan-shows";
import { computeDrift } from "./drift";
import { readBaseline, readCaptureIndex } from "./store";

/** The flows whose front matter says `screenshots: false`. */
export function optedOutFlows(written: WrittenGrimoire): string[] {
  return written.features
    .flatMap((feature) => feature.flows)
    .filter((flow) => flow.screenshots?.value === false)
    .map((flow) => flow.ref);
}

/**
 * Read the `@shows` lines, the capture index and the baseline, and compute the drift.
 *
 * @param root Absolute project root.
 * @param testFiles Project-relative test files of the book.
 */
export async function loadShotsState(
  root: string,
  written: WrittenGrimoire,
  settings: GrimoireSettings,
  testFiles: readonly string[],
  proofs: readonly ProofLine[],
): Promise<ShotsState> {
  const scanned = await scanShows(root, testFiles, written);
  const [captures, baseline] = await Promise.all([readCaptureIndex(root), readBaseline(root)]);
  const optedOut = optedOutFlows(written);
  const showsFindings: GrimoireFinding[] = scanned.findings;

  return {
    mode: settings.screenshots,
    shows: scanned.shows,
    showsFindings,
    captures,
    baseline,
    drift:
      baseline === null
        ? []
        : await computeDrift({
            root,
            written,
            proofs,
            shows: scanned.shows,
            captures,
            baseline,
            languages: settings.languages,
            optedOut,
          }),
    optedOut,
  };
}
