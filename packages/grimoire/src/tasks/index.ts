/**
 * Task files (rules owned by T-131). Parsing is T-126's; the index is T-128's.
 */
import type { GrimoireFinding } from "../contracts/findings";
import type { GrimoireSnapshot } from "../contracts/snapshot";

/** The GR7xxx rules. Read-only. */
export function checkTasks(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  void snapshot;
  throw new Error("not implemented");
}
