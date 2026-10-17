import path from "node:path";
import type { CommandActionData } from "../../../commands/types";
import { AGENTS_MD_FILE } from "../../../tooling/agents-md/agents-md-markers";
import { listInstalledSkills } from "../../../tooling/agents-md/installed-skills";
import { listAppModules, renderAgentsMdSection } from "../../../tooling/agents-md/render-agents-md";
import {
  writeAgentsMd,
  type WriteAgentsMdResult,
} from "../../../tooling/agents-md/write-agents-md";
import { bootForInspect, inspectOptionsFromBoot } from "../../../tooling/inspect/boot-for-inspect";
import { inspectApp } from "../../../tooling/inspect/inspect-app";
import type { InspectSection } from "../../../tooling/inspect/inspect-report.types";
import { withConsoleOnStderr } from "../routes/with-console-on-stderr";

/** The inspect sections the generated section reads. */
export const AGENTS_MD_SECTIONS: readonly InspectSection[] = ["routes", "models", "packages"];

/** The one line `warlock agents-md --write` prints. */
export function formatWriteStatus(result: Pick<WriteAgentsMdResult, "file" | "status">): string {
  const file = path.relative(process.cwd(), result.file) || AGENTS_MD_FILE;

  switch (result.status) {
    case "created":
      return `Created ${file} with the generated section.`;
    case "updated":
      return `Updated the generated section of ${file}.`;
    case "unchanged":
      return `${file} is up to date.`;
    default:
      return `${file} does not exist; nothing written.`;
  }
}

/**
 * Action behind `warlock agents-md`.
 *
 * Boots the app read-only (the inspect boot pass) with boot output on stderr,
 * then prints the section (no flag), writes it (`--write`) or prints
 * `{ file, status, section }` (`--json`; `status` is `"printed"` without
 * `--write`). Malformed markers throw `WL7501` and nothing is written.
 *
 * @param data Parsed CLI args: `options.write`, `options.json`.
 */
export async function agentsMdCommandAction({ options }: CommandActionData): Promise<void> {
  const cwd = process.cwd();
  const boot = await withConsoleOnStderr(() => bootForInspect(cwd));
  const report = await inspectApp({
    ...inspectOptionsFromBoot(boot),
    cwd,
    sections: AGENTS_MD_SECTIONS,
  });

  if (options.write === true) {
    const result = writeAgentsMd({ cwd, report });

    console.log(
      options.json === true ? JSON.stringify(result, null, 2) : formatWriteStatus(result),
    );
    return;
  }

  const section = renderAgentsMdSection(report, {
    skills: listInstalledSkills(cwd),
    modules: listAppModules(cwd),
  });

  if (options.json === true) {
    console.log(
      JSON.stringify({ file: path.join(cwd, AGENTS_MD_FILE), status: "printed", section }, null, 2),
    );
    return;
  }

  process.stdout.write(section);
}
