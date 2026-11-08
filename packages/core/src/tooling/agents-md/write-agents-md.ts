import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { InspectReport } from "../inspect/inspect-report.types";
import { AGENTS_MD_FILE, upsertGeneratedSection } from "./agents-md-markers";
import { type InstalledSkill, listInstalledSkills } from "./installed-skills";
import { listAppModules, renderAgentsMdSection } from "./render-agents-md";

/** The heading the renderer puts above the model list. */
const MODELS_HEADING = "### Models";

/** What {@link writeAgentsMd} did. */
export type AgentsMdWriteStatus = "created" | "updated" | "unchanged" | "skipped";

/** Options of {@link writeAgentsMd}. */
export type WriteAgentsMdOptions = {
  /** Project root. Default: `process.cwd()`. */
  cwd?: string;
  /** The inspect report to render. */
  report: InspectReport;
  /** Create AGENTS.md when it does not exist. Default: `true`; `false` reports `skipped`. */
  create?: boolean;
  /** Skills to list. Default: `listInstalledSkills(cwd)`. */
  skills?: readonly InstalledSkill[];
  /** Module folders. Default: `listAppModules(cwd)`. */
  modules?: readonly string[];
  /**
   * Leave the file alone when the new section has no models but the current
   * one lists some. For callers whose report cannot see model modules (the
   * dev server's in-process report), so a refresh never drops the Models list
   * that `warlock agents-md --write` produced. Default: `false`.
   */
  keepExistingModels?: boolean;
};

/** The result of {@link writeAgentsMd}. */
export type WriteAgentsMdResult = {
  /** Absolute path of AGENTS.md. */
  file: string;
  status: AgentsMdWriteStatus;
  /** The generated section, without markers. */
  section: string;
};

/**
 * Render the generated section and put it between the markers of
 * `<cwd>/AGENTS.md`, preserving every byte outside them. Writes only when the
 * content changed (atomically: temp file + rename). Throws `WL7501` on
 * malformed markers, before writing anything.
 *
 * @example
 * const { status } = writeAgentsMd({ report: await inspectApp() });
 */
export function writeAgentsMd(options: WriteAgentsMdOptions): WriteAgentsMdResult {
  const cwd = options.cwd ?? process.cwd();
  const file = path.join(cwd, AGENTS_MD_FILE);
  const section = renderAgentsMdSection(options.report, {
    skills: options.skills ?? listInstalledSkills(cwd),
    modules: options.modules ?? listAppModules(cwd),
  });
  const exists = existsSync(file);

  if (!exists && options.create === false) {
    return { file, status: "skipped", section };
  }

  const existing = exists ? readFileSync(file, "utf8") : undefined;

  if (
    options.keepExistingModels === true &&
    existing !== undefined &&
    !section.includes(MODELS_HEADING) &&
    existing.includes(MODELS_HEADING)
  ) {
    return { file, status: "unchanged", section };
  }

  const next = upsertGeneratedSection(existing, section);

  if (next === existing) {
    return { file, status: "unchanged", section };
  }

  const temporary = `${file}.${process.pid}.tmp`;

  writeFileSync(temporary, next, "utf8");
  renameSync(temporary, file);

  return { file, status: exists ? "updated" : "created", section };
}
