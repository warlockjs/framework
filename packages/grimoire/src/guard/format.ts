/** The text of a guard report: the check's finding lines, the changes not approved, and the verdict. */
import { formatCheckReport } from "../check/format-check-report";
import type { GrimoireCheckReport } from "../contracts/findings";
import type { GuardReport } from "../contracts/guard";

/** Lines for `warlock grimoire guard` (no `--json`). */
export function formatGuardReport(report: GuardReport, root: string): string[] {
  const check: GrimoireCheckReport = {
    schemaVersion: 1,
    root,
    findings: report.findings,
    counts: report.counts,
    ok: report.ok,
    routes: "cached",
  };
  const lines = formatCheckReport(check, { all: true }).slice(0, -1);

  if (report.notApproved.length > 0) {
    lines.push(
      `not approved: ${report.notApproved.length} change${report.notApproved.length === 1 ? "" : "s"}`,
    );

    for (const item of report.notApproved) lines.push(`  ${item.id}`);
  }

  const { errors, warnings } = report.counts;

  lines.push(
    report.ok
      ? `guard: ok${warnings > 0 ? ` (${warnings} warning${warnings === 1 ? "" : "s"})` : ""}`
      : `guard: ${errors} error${errors === 1 ? "" : "s"}`,
  );

  return lines;
}
