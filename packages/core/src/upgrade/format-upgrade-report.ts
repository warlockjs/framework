import { colors } from "@mongez/copper";
import { releaseNotesPointer } from "../release-notes/release-notes";
import type { UpgradeResult } from "./types";

/** The human-readable `warlock upgrade` report. */
export function formatUpgradeReport(result: UpgradeResult): string {
  const lines: string[] = [];
  const verb = result.dryRun ? "would change" : "changed";

  lines.push(
    colors.bold(`warlock upgrade ${result.from} → ${result.to}`) +
      (result.dryRun ? colors.dim(" (dry run: nothing written)") : ""),
    "",
  );

  for (const codemod of result.codemods) {
    const applied = result.applied.filter((item) => item.codemod === codemod.id);
    const manual = result.manual.filter((item) => item.codemod === codemod.id);
    const mark =
      applied.length > 0
        ? colors.green("✓")
        : manual.length > 0
          ? colors.yellow("!")
          : colors.dim("·");
    const counts = [
      applied.length > 0 ? `${applied.length} ${verb}` : "",
      manual.length > 0 ? `${manual.length} to review` : "",
    ]
      .filter(Boolean)
      .join(", ");

    lines.push(
      `${mark} ${codemod.id} ${colors.dim(`(${codemod.version})`)} ${codemod.title}${counts ? colors.dim(` — ${counts}`) : colors.dim(" — nothing to do")}`,
    );
    for (const item of applied) {
      lines.push(`    ${colors.cyan(`${item.file}:${item.line}`)}  ${item.description}`);
    }
    for (const item of manual) {
      lines.push(`    ${colors.yellow(`${item.file}:${item.line}`)}  ${item.hint}`);
    }
  }

  if (result.notes.length > 0) {
    lines.push("", colors.bold("Plan for (no code change):"));
    for (const note of result.notes)
      lines.push(`  - ${note.text} ${colors.dim(`(${note.version})`)}`);
  }

  if (result.dryRun && result.diff) {
    lines.push("", colors.bold("Diff:"), result.diff.trimEnd());
  }

  lines.push("");
  lines.push(
    `${result.changedFiles.length} file(s) ${verb}, ${result.manual.length} place(s) to review by hand.`,
  );
  if (result.installHint) {
    lines.push(
      `Package versions ${result.dryRun ? "would be" : "were"} updated in package.json: run ${colors.cyan(result.installHint)}.`,
    );
  }
  lines.push(
    `Then run your type check and tests. The ${colors.cyan("upgrade-from-5-29")} skill explains each change.`,
    colors.dim(releaseNotesPointer(result.from)),
  );

  return lines.join("\n");
}
