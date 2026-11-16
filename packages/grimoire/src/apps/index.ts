/**
 * Sites, mobile apps, pages, screens and blocks (rules owned by T-132).
 */
import type { GrimoireFinding } from "../contracts/findings";
import type { GrimoireSnapshot } from "../contracts/snapshot";

export { matchApps } from "./match-apps";

/** The GR5xxx rules. Read-only. */
export function checkApps(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  void snapshot;
  throw new Error("not implemented");
}
