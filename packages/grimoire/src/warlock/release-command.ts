/**
 * `warlock grimoire release [version] --stamp`: move the `## Unreleased`
 * entries of every feature changelog under `## <version> (<date>)`, write the
 * release file when it is missing, then collect the list. Contract stub of
 * the 5.64 shared contracts; the release stamping implementation replaces the
 * body.
 */
import { GrimoireError } from "../codes";
import { reportError, type CommandContext } from "./actions";

/** Stamp and collect a release; the version defaults to the app's `package.json` version. */
export async function runStampRelease(
  context: CommandContext,
  release: string | undefined,
  options: Record<string, unknown> = {},
): Promise<number> {
  void release;
  void options;

  return reportError(context.io, new GrimoireError("GR9006", "Stamping a release is not built yet."));
}
