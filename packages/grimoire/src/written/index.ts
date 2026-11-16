/**
 * The parser of the agent-written files (owned by T-126).
 *
 * Reads `grimoire/features`, `grimoire/apps`, `grimoire/tasks` and
 * `grimoire/releases`, never writes. A file that does not follow its fixed
 * structure gives `GR1xxx` findings with locations; the parser still returns
 * whatever it could read, so the other checks keep working.
 */
import type { GrimoireFinding } from "../contracts/findings";
import type { WrittenGrimoire } from "../contracts/written";

/** What `parseGrimoire()` returns. */
export type ParseGrimoireResult = {
  written: WrittenGrimoire;
  /** Structure findings (`GR1xxx`), in file and line order. */
  findings: GrimoireFinding[];
};

/**
 * Parse every written file under `<root>/grimoire`. A project without a
 * `grimoire/` folder gives `written.exists === false` and no findings.
 *
 * @param root Absolute project root.
 */
export async function parseGrimoire(root: string): Promise<ParseGrimoireResult> {
  void root;
  throw new Error("not implemented");
}
