import { readLog, listManifests, readPointer, type ReleaseContext } from "./store";
import type { ReleaseLogEntry, ReleaseManifest } from "./types";

export type ReleaseListing = {
  current: string | null;
  previous: string | null;
  releases: ReleaseManifest[];
};

export type ReleaseStatusReport = {
  current: string | null;
  previous: string | null;
  active: ReleaseManifest | null;
  log: ReleaseLogEntry[];
};

/** Every release, newest first, with the two pointers. */
export async function listReleases(context: ReleaseContext): Promise<ReleaseListing> {
  return {
    current: await readPointer(context, "current"),
    previous: await readPointer(context, "previous"),
    releases: await listManifests(context),
  };
}

/** The active release with the last entries of the release log. */
export async function releaseStatus(
  context: ReleaseContext,
  logLimit = 10,
): Promise<ReleaseStatusReport> {
  const listing = await listReleases(context);

  return {
    current: listing.current,
    previous: listing.previous,
    active: listing.releases.find((release) => release.id === listing.current) ?? null,
    log: (await readLog(context)).slice(-logLimit),
  };
}
