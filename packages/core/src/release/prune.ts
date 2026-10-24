import { rm } from "node:fs/promises";
import { appendLog, listManifests, readPointer, releaseDir, type ReleaseContext } from "./store";

export type PruneResult = {
  kept: string[];
  removed: string[];
  dryRun: boolean;
};

/**
 * Delete old releases, keeping the newest `keep`. The release `current` names
 * and the one `previous` names are always kept, whatever their age. This is
 * the only operation that removes a release.
 *
 * @example
 * await pruneReleases(context, { keep: 5 });
 */
export async function pruneReleases(
  context: ReleaseContext,
  options: { keep: number; dryRun?: boolean },
): Promise<PruneResult> {
  if (!Number.isInteger(options.keep) || options.keep < 1) {
    throw new Error("--keep must be a whole number of at least 1.");
  }

  const manifests = await listManifests(context);
  const pinned = new Set(
    [await readPointer(context, "current"), await readPointer(context, "previous")].filter(
      (id): id is string => id !== null,
    ),
  );
  const kept = new Set(manifests.slice(0, options.keep).map((manifest) => manifest.id));
  const removed: string[] = [];

  for (const manifest of manifests) {
    if (kept.has(manifest.id) || pinned.has(manifest.id)) continue;

    removed.push(manifest.id);

    if (!options.dryRun) {
      await rm(releaseDir(context, manifest.id), { recursive: true, force: true });
    }
  }

  if (!options.dryRun && removed.length > 0) {
    await appendLog(context, {
      event: "prune",
      release: null,
      ok: true,
      detail: `removed ${removed.join(", ")}`,
    });
  }

  return {
    kept: manifests
      .filter((manifest) => !removed.includes(manifest.id))
      .map((manifest) => manifest.id),
    removed,
    dryRun: options.dryRun === true,
  };
}
