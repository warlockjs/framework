import { colors } from "@mongez/copper";
import type { CommandActionData } from "../../../commands/types";
import { bootForInspect, inspectOptionsFromBoot } from "../../../tooling/inspect/boot-for-inspect";
import { inspectApp, parseInspectSections } from "../../../tooling/inspect/inspect-app";
import type { InspectReport } from "../../../tooling/inspect/inspect-report.types";
import { withConsoleOnStderr } from "../routes/with-console-on-stderr";

function stringOption(value: string | number | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * The human summary `warlock inspect` prints without `--json`: one count per
 * section, the routes as `METHOD path  [auth] name`, and the warnings.
 * Returned as lines so it is testable.
 */
export function formatInspectSummary(report: InspectReport): string[] {
  const lines: string[] = [
    `${report.app.name ?? "app"}${report.app.version ? `@${report.app.version}` : ""} (${report.app.runtimeStrategy}, Node ${report.app.node})`,
    "",
  ];

  const counts: [string, number | undefined][] = [
    ["routes", report.routes?.length],
    ["models", report.models?.length],
    ["resources", report.resources?.length],
    ["config keys", report.config?.length],
    ["events", report.events?.length],
    ["pages", report.pages?.length],
    ["jobs", report.jobs?.length],
    ["schedules", report.schedules?.length],
    ["packages", report.packages?.length],
  ];

  for (const [label, count] of counts) {
    if (count !== undefined) lines.push(`  ${label.padEnd(12)} ${count}`);
  }

  if (report.routes && report.routes.length > 0) {
    lines.push("", "Routes:");

    for (const route of report.routes) {
      const guard = route.auth.required ? " [auth]" : "";
      const name = route.name ? `  ${route.name}` : "";

      lines.push(`  ${route.method.padEnd(7)} ${route.path}${guard}${name}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("", `${report.warnings.length} warning(s):`);

    for (const warning of report.warnings) {
      lines.push(`  - ${warning.code ? `${warning.code} ` : ""}${warning.message}`);
    }
  }

  lines.push("", "Run `warlock inspect --json` for the full report.");

  return lines;
}

/**
 * Action behind `warlock inspect`.
 *
 * Boots the app read-only (the `warlock doctor` boot pass: connectors booted,
 * none started, no connection, no port), then describes it with
 * `inspectApp()`. With `--json`, stdout carries exactly the report and the
 * boot's progress lines go to stderr.
 *
 * @param data Parsed CLI args: `options.json`, `options.section`.
 */
export async function inspectCommandAction({ options }: CommandActionData): Promise<void> {
  // Parsed first, so a typo fails before the app boots.
  const sections = parseInspectSections(stringOption(options.section));
  const json = options.json === true;
  const boot = json ? await withConsoleOnStderr(() => bootForInspect()) : await bootForInspect();
  const report = await inspectApp({ ...inspectOptionsFromBoot(boot), sections });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const [heading, ...rest] = formatInspectSummary(report);

  console.log(colors.bold(heading ?? ""));

  for (const line of rest) {
    console.log(line);
  }
}
