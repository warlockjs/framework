import type { UpgradeNote } from "./types";

/**
 * Breaking changes with nothing to edit in source: they change data or
 * operations. Printed so the rollout plans for them.
 */
export const UPGRADE_NOTES: readonly UpgradeNote[] = [
  {
    version: "5.30.0",
    text: "Auth login throttle keys are hashed: counters and lockouts written by 5.29 are forgotten on upgrade (locked accounts and IPs unlock).",
  },
  {
    version: "5.30.0",
    text: "Image derivatives use a new cache layout: the first request re-renders each one. Delete the old two-level cache folders once the rollout is done.",
  },
];
