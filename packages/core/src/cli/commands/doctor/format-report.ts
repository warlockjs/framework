import { colors } from "@mongez/copper";
import { ERROR_CODES, errorCodeDocsUrl, type WarlockErrorCode } from "../../../errors/error-codes";
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
    const code = result.code ? ` [${result.code}]` : "";

    return `${STATUS_SYMBOL[result.status]} ${result.name}: ${result.detail}${code}`;
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

    const code = result.code ? colors.dim(` [${result.code}]`) : "";

    console.log(`${symbol} ${colors.bold(result.name)}: ${result.detail}${code}`);
  }

  const { ok, warn, fail } = report.summary;
  const summaryLine = `Summary: ${ok} ok, ${warn} warn, ${fail} fail`;

  console.log("");
  console.log(report.hasFailures ? colors.red(summaryLine) : colors.green(summaryLine));
}

/** One check in `warlock doctor --json`. Every key is always present. */
export type DoctorJsonResult = {
  name: string;
  status: CheckStatus;
  detail: string;
  /** Stable Warlock error code of a `warn`/`fail` verdict, else `null`. */
  code: WarlockErrorCode | null;
  /** One line on what to do, from the code registry, else `null`. */
  hint: string | null;
  /** Slug of the skill that explains the fix, else `null`. */
  skill: string | null;
  /** Docs URL of the code, else `null`. */
  docs: string | null;
};

/** What `warlock doctor --json` prints. */
export type DoctorJsonReport = {
  schemaVersion: 1;
  results: DoctorJsonResult[];
  summary: Record<CheckStatus, number>;
  exitCode: 0 | 1;
};

/**
 * The machine-readable form of a doctor report: each finding with its stable
 * code and the same `hint` / `skill` / `docs` fields `warlock check --json`
 * prints, so one consumer reads both.
 *
 * @param report The aggregated doctor report.
 */
export function toDoctorJson(report: DoctorReport): DoctorJsonReport {
  return {
    schemaVersion: 1,
    results: report.results.map((result) => {
      const definition = result.code ? ERROR_CODES[result.code] : undefined;

      return {
        name: result.name,
        status: result.status,
        detail: result.detail,
        code: result.code ?? null,
        hint: definition?.fix ?? null,
        skill: definition?.skill ?? null,
        docs: result.code ? errorCodeDocsUrl(result.code) : null,
      };
    }),
    summary: { ...report.summary },
    exitCode: report.exitCode,
  };
}
