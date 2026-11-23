/**
 * `warlock grimoire approve api`: write the routes into
 * `grimoire/approved/api.json`, the approved public API. Reads the cached
 * route facts (run `warlock grimoire build` first); never boots the app.
 */
import { GrimoireError } from "../codes";
import { GRIMOIRE_PATHS } from "../paths";
import {
  readApiSnapshot,
  routeLines,
  writeApiSnapshot,
  diffRoutes,
  describeRouteDiff,
} from "../guard";
import { openGrimoire } from "../workspace";
import { reportError, type CommandContext } from "./actions";

/** Approve the current public API. Exit code 0 when written. */
export async function runApproveApi(
  context: CommandContext,
  options: Record<string, unknown> = {},
): Promise<number> {
  const { root, adapter, io } = context;

  try {
    const snapshot = await openGrimoire(root, adapter, { routes: "cached" });
    const routes = snapshot.book.facts.routes;

    if (routes === null) {
      throw new GrimoireError(
        "GR9006",
        "The book has no route facts yet, so there is no API to approve. Run warlock grimoire build first.",
      );
    }

    const lines = routeLines(routes);
    const before = await readApiSnapshot(root);
    const diff = diffRoutes(before?.routes ?? [], lines);
    const approved = await writeApiSnapshot(root, lines);

    if (options.json === true) {
      io.out(JSON.stringify({ file: GRIMOIRE_PATHS.apiSnapshot, ...approved, ...diff }, null, 2));

      return 0;
    }

    io.out(
      `approved the public API: ${lines.length} route${lines.length === 1 ? "" : "s"} in ${GRIMOIRE_PATHS.apiSnapshot}${
        before === null
          ? ""
          : diff.added.length + diff.removed.length === 0
            ? " (unchanged)"
            : ` (${describeRouteDiff(diff)})`
      }`,
    );

    return 0;
  } catch (error) {
    return reportError(io, error);
  }
}
