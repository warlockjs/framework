/**
 * GR7013: the routes differ from the approved public API (`grimoire/approved/api.json`).
 * Contract stub of the 5.64 shared contracts: registered in `CHECK_RULES`,
 * the implementation replaces the body.
 */
import type { GrimoireFinding } from "../../contracts/findings";
import type { GrimoireSnapshot } from "../../contracts/snapshot";

export function checkApiSnapshot(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  void snapshot;

  return [];
}
