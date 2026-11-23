/**
 * GR4011, GR4012: tests focused with `.only` or skipped with `.skip`.
 * Contract stub of the 5.64 shared contracts: registered in `CHECK_RULES`,
 * the implementation replaces the body.
 */
import type { GrimoireFinding } from "../../contracts/findings";
import type { GrimoireSnapshot } from "../../contracts/snapshot";

export function checkFocusedTests(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  void snapshot;

  return [];
}
