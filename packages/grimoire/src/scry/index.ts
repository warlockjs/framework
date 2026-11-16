/**
 * `scry` (owned by T-130): answers a query from a snapshot, and prints it.
 */
import type { ScryQuery, ScryResult } from "../contracts/scry";
import type { GrimoireSnapshot } from "../contracts/snapshot";

/**
 * Answer one query. Throws a `GrimoireError`: `GR9001` for a file not in the
 * book, `GR9002` no route, `GR9003` no feature, `GR9004` no flow. Pure.
 */
export function scry(snapshot: GrimoireSnapshot, query: ScryQuery): ScryResult {
  void snapshot;
  void query;
  throw new Error("not implemented");
}

/** The compact text of a result (formats in ARCHITECTURE.md). */
export function formatScryResult(result: ScryResult): string[] {
  void result;
  throw new Error("not implemented");
}

/**
 * The query of `warlock scry` arguments: a positional file, or one of the
 * options `impact`, `route`, `feature`, `flow`, `search` (with `limit`).
 * Throws `GrimoireError` `GR9006` for none, several, or a malformed value.
 */
export function parseScryQuery(
  args: readonly string[],
  options: Readonly<Record<string, string | boolean | number>>,
): ScryQuery {
  void args;
  void options;
  throw new Error("not implemented");
}
