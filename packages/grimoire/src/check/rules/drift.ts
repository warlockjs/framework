/**
 * GR4017-GR4019: changes since the approved baseline, and rejected changes still there.
 * Contract stub of the 5.64 shared contracts: registered in `CHECK_RULES`,
 * the implementation replaces the body.
 */
import type { GrimoireFinding } from "../../contracts/findings";
import type { GrimoireSnapshot } from "../../contracts/snapshot";

export function checkDrift(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  void snapshot;

  return [];
}
