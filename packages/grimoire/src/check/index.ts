/**
 * `warlock grimoire check` (owned by T-129): every rule, read-only.
 *
 * `checkGrimoire` runs, in order: the structure findings, the proof findings,
 * the T-129 rules (GR2xxx, GR3xxx, GR4001–GR4002, GR6004–GR6008), `checkApps`
 * (T-132, GR5xxx), `checkReleases` (T-131, GR6001–GR6003), `checkTasks`
 * (T-131, GR7xxx), `checkTestResults` (T-133, GR4006–GR4008), and the book
 * notes (GR8003 from `snapshot.routes`). Then it marks `expected` on every
 * finding whose `subject.feature` or `subject.flow` has status `proposed`,
 * and sorts.
 */
export { checkGrimoire } from "./check-grimoire";
export { formatCheckReport } from "./format-check-report";
