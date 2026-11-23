/**
 * `warlock grimoire approve <target>` and `reject <target>`: accept or refuse
 * a change since the approved baseline (`grimoire/approved/baseline.json`).
 * Contract stub of the 5.64 shared contracts; the approvals implementation
 * replaces the bodies.
 */
import { GrimoireError } from "../codes";
import { reportError, type CommandContext } from "./actions";

/**
 * Approve the drift items `target` names: a drift id, a `<feature>/<flow>`
 * (every item of the flow), or every item with `--all`; `--lang` keeps one
 * language's images. Exit code 0 when something was approved.
 */
export async function runApprove(
  context: CommandContext,
  target: string | undefined,
  options: Record<string, unknown> = {},
): Promise<number> {
  void target;
  void options;

  return reportError(context.io, new GrimoireError("GR9010", "Approving is not built yet."));
}

/** Reject the drift items `target` names (same targets as approve; `--note` records why). */
export async function runReject(
  context: CommandContext,
  target: string | undefined,
  options: Record<string, unknown> = {},
): Promise<number> {
  void target;
  void options;

  return reportError(context.io, new GrimoireError("GR9010", "Rejecting is not built yet."));
}
