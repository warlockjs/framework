import type { GrimoireCheckReport, GrimoireFinding } from "../contracts/findings";

/** Warnings of one code shown before the rest are counted ("… and N more"). */
const EXAMPLES_PER_CODE = 5;

/** What the text formatter may be told. */
export type FormatCheckOptions = {
  /** List every finding, not only the first few warnings of each code. */
  all?: boolean;
};

/**
 * The compact text of a report: one line per finding,
 * `<file>:<line>  <code>  <severity>  <message>[  (expected)]` (`-` when the
 * finding has no location), `    fix: <hint>` under each unexpected error, and
 * a last line with the counts and the route freshness.
 *
 * Errors always print in full. Warnings of a code that has more than five
 * findings print the first five, then a line with the count of the rest and a
 * last hint to run with `--all`. `options.all` prints every finding.
 */
export function formatCheckReport(
  report: GrimoireCheckReport,
  options: FormatCheckOptions = {},
): string[] {
  const lines: string[] = [];
  const perCode = new Map<string, number>();
  const shown = new Map<string, number>();
  let hidden = 0;

  for (const finding of report.findings) {
    if (finding.severity !== "error") {
      perCode.set(finding.code, (perCode.get(finding.code) ?? 0) + 1);
    }
  }

  for (const finding of report.findings) {
    if (finding.severity !== "error" && options.all !== true) {
      const total = perCode.get(finding.code) ?? 0;
      const count = (shown.get(finding.code) ?? 0) + 1;

      shown.set(finding.code, count);

      if (total > EXAMPLES_PER_CODE && count > EXAMPLES_PER_CODE) {
        hidden++;

        continue;
      }
    }

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

    const total = perCode.get(finding.code) ?? 0;

    if (
      finding.severity !== "error" &&
      options.all !== true &&
      total > EXAMPLES_PER_CODE &&
      shown.get(finding.code) === EXAMPLES_PER_CODE
    ) {
      lines.push(
        `    … ${finding.code}: ${total} findings in all, ${total - EXAMPLES_PER_CODE} not shown`,
      );
    }
  }

  const { errors, warnings, expected } = report.counts;

  if (hidden > 0)
    lines.push(`${plural(hidden, "finding")} not listed; run with --all to list every finding.`);

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
