/**
 * `warlock grimoire approve api`: write the routes into
 * `grimoire/approved/api.json`, the approved public API. Contract stub of the
 * 5.64 shared contracts; the guard implementation replaces the body.
 */
import { GrimoireError } from "../codes";
import { reportError, type CommandContext } from "./actions";

/** Approve the current public API. Exit code 0 when written. */
export async function runApproveApi(
  context: CommandContext,
  options: Record<string, unknown> = {},
): Promise<number> {
  void options;

  return reportError(context.io, new GrimoireError("GR9010", "Approving the API is not built yet."));
}
