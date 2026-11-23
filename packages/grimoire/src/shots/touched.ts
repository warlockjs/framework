/**
 * The features a change touches, for the `changed` screenshot mode: the
 * features whose files changed against the base (by the stored ownership),
 * and the features whose `grimoire/features/<id>/` files changed.
 */
import { changedFiles, resolveBase } from "../git";
import type { Ownership } from "../contracts/bookmap";

/** The feature that owns a project file (`null` when none does). */
export type OwnerLookup = (file: string) => string | null;

/** An {@link OwnerLookup} over the ownership a snapshot carries. */
export function ownersFrom(ownership: Ownership): OwnerLookup {
  return (file) => ownership.files[file]?.owner ?? null;
}

/**
 * The ids of the touched features, or `null` when they cannot be known (no
 * git, no base, a git error): the caller then captures everything.
 */
export async function touchedFeatures(
  root: string,
  owners: OwnerLookup,
): Promise<Set<string> | null> {
  try {
    const base = await resolveBase(root);
    const files = await changedFiles(root, base);
    const touched = new Set<string>();

    for (const change of files) {
      const written = /^grimoire\/features\/([^/]+)\//.exec(change.file);

      if (written?.[1]) touched.add(written[1]);

      for (const file of [change.file, change.from]) {
        const owner = file === null ? null : owners(file);

        if (owner !== null) touched.add(owner);
      }
    }

    return touched;
  } catch {
    return null;
  }
}
