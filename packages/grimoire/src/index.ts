/**
 * `@warlock.js/grimoire` — experimental. A project map for agents and
 * developers: a generated book of the code, the agent-written features,
 * flows, apps, tasks and releases, a read-only check, and scry queries.
 *
 * This root entry is framework-neutral: it must never import
 * `@warlock.js/core` or `@warlock.js/web` (a spec enforces it). Warlock's
 * adapter and commands live in `@warlock.js/grimoire/warlock`.
 */
export * from "./contracts";

export {
  createFinding,
  explainGrimoireCode,
  GRIMOIRE_CODE_LIST,
  GRIMOIRE_CODES,
  GRIMOIRE_CODES_DOCS_URL,
  GrimoireError,
  grimoireCodeDocsUrl,
  isGrimoireCode,
  type GrimoireCode,
} from "./codes";
export {
  bookEntryPath,
  bookEntryPaths,
  GRIMOIRE_DIR,
  GRIMOIRE_IGNORE_RULES,
  GRIMOIRE_PATHS,
  toPosixPath,
  type BookPathInput,
} from "./paths";
export {
  readFrontMatter,
  type FrontMatterField,
  type FrontMatterResult,
  type FrontMatterValue,
} from "./front-matter";
export { fileGraph, importClosure, importerClosure, type FileGraph } from "./graph";

export { parseGrimoire, type ParseGrimoireResult } from "./written";
export { buildBook, checkBook, loadBook, writeBook, type BookCheck } from "./book";
export { resolveOwnership } from "./ownership";
export { matchApps } from "./apps";
export { buildCollectedFiles, writeCollectedFiles, type CollectedInput } from "./bookmap";
export { openGrimoire } from "./workspace";
export { openStoredGrimoire } from "./workspace/stored";
export { scanProofs, scanProofsInText, type ScanProofsResult } from "./proves";
export { checkGrimoire, formatCheckReport } from "./check";
export { collectRelease, renderCollectedList, writeRelease } from "./releases";
export { criterionStatus, readTestResults, type CriterionTestResult } from "./test-results";
export { formatScryResult, parseScryQuery, SCRY_STOP_WORDS, scry } from "./scry";
