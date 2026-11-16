/**
 * Releases (owned by T-131): collecting changelog entries into
 * `grimoire/releases/<release>.md`, and the GR6001–GR6003 rules.
 */
import type { GrimoireFinding } from "../contracts/findings";
import type { ReleaseCollection, WriteReleaseResult } from "../contracts/releases";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type { WrittenGrimoire } from "../contracts/written";

/**
 * The entries a release lists (rules in `contracts/releases.ts`). Throws a
 * `GrimoireError` with `GR9005` when `grimoire/releases/<release>.md` does not
 * exist or has no `release` and `date`.
 */
export function collectRelease(written: WrittenGrimoire, release: string): ReleaseCollection {
  void written;
  void release;
  throw new Error("not implemented");
}

/** The Markdown between (and including) the collected-list markers. Pure. */
export function renderCollectedList(collection: ReleaseCollection): string {
  void collection;
  throw new Error("not implemented");
}

/**
 * Collect the release and write the list into its file: replaces the text
 * between the markers, or appends the markers and the list at the end. Never
 * touches any other file or any text outside the markers.
 *
 * @param root Absolute project root.
 */
export async function writeRelease(
  root: string,
  written: WrittenGrimoire,
  release: string,
): Promise<WriteReleaseResult> {
  void root;
  void written;
  void release;
  throw new Error("not implemented");
}

/** The GR6001–GR6003 rules. Read-only. */
export function checkReleases(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  void snapshot;
  throw new Error("not implemented");
}
