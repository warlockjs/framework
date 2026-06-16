import changelog from "../data/changelog.json";

type ChangelogData = { releases?: Array<{ version?: string }> };

/**
 * Current framework version — the newest released entry in the unified
 * changelog (releases are sorted newest-first by generate-changelog.mjs).
 * Falls back to the major line if the changelog is somehow empty.
 */
export const currentVersion: string =
  (changelog as ChangelogData).releases?.[0]?.version ?? "4";
