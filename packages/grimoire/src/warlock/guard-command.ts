/**
 * `warlock grimoire guard [task]`: the change (git diff against the base)
 * checked against its task. Contract stub of the 5.64 shared contracts; the
 * guard implementation replaces the body.
 */
import { GrimoireError } from "../codes";
import { reportError, type CommandContext } from "./actions";

/** Options the command passes (`--base`, `--commits`, `--hook`, `--json`). */
export type GuardCommandOptions = Record<string, unknown>;

/**
 * Run the guard and print its report. Exit code: 0 when no error, 1 on an
 * error finding; with `--hook`, 2 instead of 1 (findings on stderr).
 */
export async function runGuard(
  context: CommandContext,
  task: string | undefined,
  options: GuardCommandOptions = {},
): Promise<number> {
  void task;
  void options;

  return reportError(context.io, new GrimoireError("GR9008", "The guard is not built yet."));
}
