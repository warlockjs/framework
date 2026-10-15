import { colors } from "@mongez/copper";
import type { CheckStatus, DoctorReport } from "./check.types";

/**
 * The glyph shown beside each check, keyed by status.
 */
const STATUS_SYMBOL: Record<CheckStatus, string> = {
  ok: "✓",
  warn: "⚠",
  fail: "✗",
};

/**
 * Colorize a status glyph. Kept separate from {@link STATUS_SYMBOL} so the
 * plain glyphs remain available for snapshot-friendly, color-free assertions.
 */
function colorizeSymbol(status: CheckStatus): string {
  const symbol = STATUS_SYMBOL[status];

  switch (status) {
    case "ok":
      return colors.green(symbol);
    case "warn":
      return colors.yellow(symbol);
    case "fail":
      return colors.red(symbol);
  }
}

/**
 * Build the report body as an ordered list of plain (uncolored) lines:
 * one `<symbol> <name>: <detail>` line per check, a blank line, then a summary
 * line. Returned as strings (not printed) so the formatting is unit-testable.
 *
 * @param report The aggregated doctor report.
 * @returns The lines to print, top to bottom.
 */
export function formatReportLines(report: DoctorReport): string[] {
  const lines = report.results.map((result) => {
    return `${STATUS_SYMBOL[result.status]} ${result.name}: ${result.detail}`;
  });

  const { ok, warn, fail } = report.summary;

  lines.push("");
  lines.push(`Summary: ${ok} ok, ${warn} warn, ${fail} fail`);

  return lines;
}

/**
 * Print the report to stdout with colored status glyphs and a colored summary
 * verdict. Thin wrapper over {@link formatReportLines} — the structured report
 * stays the source of truth for the exit code.
 *
 * @param report The aggregated doctor report.
 */
export function printReport(report: DoctorReport): void {
  for (const result of report.results) {
    const symbol = colorizeSymbol(result.status);

    console.log(`${symbol} ${colors.bold(result.name)}: ${result.detail}`);
  }

  const { ok, warn, fail } = report.summary;
  const summaryLine = `Summary: ${ok} ok, ${warn} warn, ${fail} fail`;

  console.log("");
  console.log(report.hasFailures ? colors.red(summaryLine) : colors.green(summaryLine));
}
