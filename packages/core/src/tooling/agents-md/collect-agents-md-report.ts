import { filesOrchestrator } from "../../dev-server/files-orchestrator";
import { inspectApp } from "../inspect/inspect-app";
import type { InspectModelModule } from "../inspect/collect-models";
import type { InspectReport, InspectSection } from "../inspect/inspect-report.types";

/** The inspect sections the generated AGENTS.md section reads. */
export const AGENTS_MD_SECTIONS: readonly InspectSection[] = ["routes", "models", "packages"];

/** Options of {@link collectAgentsMdReport}. */
export type CollectAgentsMdReportOptions = {
  /** Project root. Default: `process.cwd()`. */
  cwd?: string;
  /** The model modules (file + exports) the models list is read from. */
  modelModules?: readonly InspectModelModule[];
};

/**
 * The one report every AGENTS.md writer renders from: `warlock agents-md`
 * (boot pass) and the `warlock dev` refresh (live modules) both call this, so
 * the same app yields the same generated section.
 */
export function collectAgentsMdReport(
  options: CollectAgentsMdReportOptions = {},
): Promise<InspectReport> {
  return inspectApp({
    cwd: options.cwd ?? process.cwd(),
    sections: AGENTS_MD_SECTIONS,
    modelModules: options.modelModules,
  });
}

/**
 * The model modules the running dev server has loaded, in the shape the boot
 * pass produces (project-relative file + exports).
 */
export function collectDevModelModules(): InspectModelModule[] {
  const modules: InspectModelModule[] = [];

  for (const file of filesOrchestrator.files.values()) {
    if (file.type !== "model") continue;

    const exports = filesOrchestrator.moduleLoader.getLoadedModule(file.absolutePath);

    if (exports) modules.push({ file: file.relativePath, exports: { ...exports } });
  }

  return modules;
}
