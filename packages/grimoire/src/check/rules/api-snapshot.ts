/**
 * GR7013: the routes differ from the approved public API
 * (`grimoire/approved/api.json`, written by `warlock grimoire approve api`).
 * Nothing is reported while no API was approved or no route facts exist.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createFinding } from "../../codes";
import type { GrimoireFinding } from "../../contracts/findings";
import type { ApiSnapshot } from "../../contracts/guard";
import type { GrimoireSnapshot } from "../../contracts/snapshot";
import { describeRouteDiff, diffRoutes, parseApiSnapshot, routeLines } from "../../guard/api";
import { GRIMOIRE_PATHS } from "../../paths";

function readApprovedSync(root: string): ApiSnapshot | null {
  try {
    return parseApiSnapshot(
      readFileSync(path.join(root, ...GRIMOIRE_PATHS.apiSnapshot.split("/")), "utf8"),
    );
  } catch {
    return null;
  }
}

export function checkApiSnapshot(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const routes = snapshot.book.facts.routes;
  const approved = readApprovedSync(snapshot.root);

  if (approved === null || routes === null) return [];

  const diff = diffRoutes(approved.routes, routeLines(routes));

  if (diff.added.length + diff.removed.length === 0) return [];

  return [
    createFinding({
      code: "GR7013",
      message: `the public API differs from the approved one: ${describeRouteDiff(diff)}`,
      at: { file: GRIMOIRE_PATHS.apiSnapshot, line: 1, column: null },
    }),
  ];
}
