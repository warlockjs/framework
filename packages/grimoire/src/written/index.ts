/**
 * The parser of the agent-written files.
 *
 * Reads `grimoire/features`, `grimoire/apps`, `grimoire/tasks` and
 * `grimoire/releases`, never writes. A file that does not follow its fixed
 * structure gives `GR1xxx` findings with locations; the parser still returns
 * whatever it could read, so the other checks keep working.
 */
export { parseGrimoire, type ParseGrimoireResult } from "./parse-grimoire";
export { parseSettings, resolveSettings } from "./settings";
