import { colors } from "@mongez/copper";
import type { UpgradeCheckResult } from "./check-upgrade";

function seconds(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

/** The human-readable `warlock upgrade --check` report. */
export function formatUpgradeCheckReport(result: UpgradeCheckResult): string {
  const lines: string[] = [
    colors.bold(`warlock upgrade --check ${result.from} → ${result.to}`),
    colors.dim("Rehearsed on a copy; your project was not changed."),
    "",
    `Package manager: ${colors.bold(result.packageManager)}, because ${result.packageManagerReason}.`,
    "",
    colors.bold("Breaking changes that hit this app:"),
  ];

  if (result.hits.length === 0) {
    lines.push("  none");
  }

  for (const hit of result.hits) {
    const counts = [
      hit.applied > 0 ? `${hit.applied} rewritten` : "",
      hit.manual > 0 ? `${hit.manual} to review` : "",
    ]
      .filter(Boolean)
      .join(", ");

    lines.push(
      `  ${hit.manual > 0 ? colors.yellow("!") : colors.green("✓")} ${hit.codemod} ${colors.dim(`(${hit.version})`)} ${hit.title} ${colors.dim(`— ${counts}`)}`,
    );

    for (const file of hit.files.slice(0, 8)) lines.push(`      ${colors.cyan(file)}`);

    if (hit.files.length > 8) lines.push(colors.dim(`      … and ${hit.files.length - 8} more file(s)`));

    lines.push(colors.dim(`      see the ${hit.skill} skill`));
  }

  for (const manual of result.upgrade.manual) {
    lines.push(`  ${colors.yellow(`${manual.file}:${manual.line}`)}  ${manual.hint}`);
  }

  if (result.upgrade.notes.length > 0) {
    lines.push("", colors.bold("Plan for (no code change):"));
    for (const note of result.upgrade.notes)
      lines.push(`  - ${note.text} ${colors.dim(`(${note.version})`)}`);
  }

  lines.push("", colors.bold("Results on the upgraded copy:"));

  for (const entry of result.steps) {
    const mark =
      entry.status === "passed"
        ? colors.green("✓")
        : entry.status === "failed"
          ? colors.red("✖")
          : colors.dim("·");

    lines.push(
      `  ${mark} ${entry.title} ${colors.dim(entry.status === "skipped" ? "" : `(${seconds(entry.durationMs)})`)}`.trimEnd(),
    );

    if (entry.detail) lines.push(colors.dim(`      ${entry.detail}`));

    if (entry.status === "failed" && entry.output) {
      for (const line of entry.output.trimEnd().split("\n").slice(-15)) lines.push(`      ${line}`);
    }
  }

  lines.push("");

  lines.push(
    result.ok
      ? `${colors.green("✓")} Every step that ran passed.`
      : `${colors.red("✖")} ${result.steps.filter((entry) => entry.status === "failed").length} step(s) failed on the upgraded copy.`,
  );

  if (result.steps.some((entry) => entry.status === "skipped")) {
    lines.push(colors.dim("Skipped steps were not checked."));
  }

  lines.push(
    result.kept
      ? `The copy was kept at ${colors.cyan(result.scratch)}. Delete it when you are done.`
      : colors.dim("The copy was deleted."),
    `To apply the upgrade for real: ${colors.cyan(`warlock upgrade --from ${result.from} --to ${result.to}`)}`,
  );

  return lines.join("\n");
}
