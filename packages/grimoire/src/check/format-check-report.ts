import type { GrimoireCheckReport, GrimoireFinding } from "../contracts/findings";

/**
 * The compact text of a report: one line per finding,
 * `<file>:<line>  <code>  <severity>  <message>[  (expected)]` (`-` when the
 * finding has no location), `    fix: <hint>` under each unexpected error, and
 * a last line with the counts and the route freshness.
 */
export function formatCheckReport(report: GrimoireCheckReport): string[] {
  const lines: string[] = [];

  for (const finding of report.findings) {
    lines.push(
      [
        location(finding),
        finding.code,
        finding.severity,
        finding.message,
        ...(finding.expected ? ["(expected)"] : []),
      ].join("  "),
    );

    if (finding.severity === "error" && !finding.expected) lines.push(`    fix: ${finding.hint}`);
  }

  const { errors, warnings, expected } = report.counts;

  lines.push(
    `${plural(errors, "error")}, ${plural(warnings, "warning")}, ${expected} expected  (routes: ${report.routes})`,
  );

  return lines;
}

function location(finding: GrimoireFinding): string {
  return finding.at ? `${finding.at.file}:${finding.at.line}` : "-";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
