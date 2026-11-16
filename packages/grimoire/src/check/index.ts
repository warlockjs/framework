/**
 * `warlock grimoire check` (owned by T-129): every rule, read-only.
 *
 * `checkGrimoire` runs, in order: the structure findings, the proof findings,
 * the T-129 rules (GR2xxx, GR3xxx, GR4001–GR4002, GR6004–GR6008), `checkApps`
 * (T-132, GR5xxx), `checkReleases` (T-131, GR6001–GR6003), `checkTasks`
 * (T-131, GR7xxx), `checkTestResults` (T-133, GR4006–GR4008), and the book
 * notes (GR8002/GR8003 from `snapshot.routes`). Then it marks `expected` on
 * every finding whose `subject.feature` or `subject.flow` has status
 * `proposed`, and sorts.
 */
import type { GrimoireCheckReport } from "../contracts/findings";
import type { GrimoireSnapshot } from "../contracts/snapshot";

/** Run every rule over a snapshot. Pure; never writes. */
export function checkGrimoire(snapshot: GrimoireSnapshot): GrimoireCheckReport {
  void snapshot;
  throw new Error("not implemented");
}

/**
 * The compact text of a report: one line per finding,
 * `<file>:<line>  <code>  <message>`, then `    fix: <hint>` for errors,
 * `(expected)` after findings on proposed work, and a last line with the
 * counts. See ARCHITECTURE.md for the exact output.
 */
export function formatCheckReport(report: GrimoireCheckReport): string[] {
  void report;
  throw new Error("not implemented");
}
