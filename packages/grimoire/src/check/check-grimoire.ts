import { checkApps } from "../apps";
import type { GrimoireCheckReport, GrimoireFinding } from "../contracts/findings";
import type { GrimoireRule, GrimoireSnapshot } from "../contracts/snapshot";
import { checkReleases } from "../releases";
import { checkTasks } from "../tasks";
import { checkTestResults } from "../test-results";
import { checkApiSnapshot } from "./rules/api-snapshot";
import { checkBookNotes } from "./rules/book-notes";
import { checkCodeRules } from "./rules/code-rules";
import { checkCaseCriteria, checkCriteriaTests, checkProofTargets } from "./rules/criteria";
import { checkDrift } from "./rules/drift";
import { checkFocusedTests } from "./rules/focused-tests";
import { checkAppNames, checkChangelogLinks, checkRelations, checkSteps } from "./rules/links";
import { checkScreenshots } from "./rules/screenshots";
import { checkShows } from "./rules/shows";
import { checkFolders, checkHeaders, checkOwners, checkUnreached } from "./rules/source-files";
import { checkChangeWords, checkFlowVersions, checkReadmeDates } from "./rules/versions";

/** The check's own rules, in report order before sorting. */
export const CHECK_RULES: readonly GrimoireRule[] = [
  checkSteps,
  checkAppNames,
  checkChangelogLinks,
  checkRelations,
  checkHeaders,
  checkOwners,
  checkFolders,
  checkUnreached,
  checkCaseCriteria,
  checkScreenshots,
  checkCriteriaTests,
  checkProofTargets,
  checkReadmeDates,
  checkChangeWords,
  checkFlowVersions,
  checkCodeRules,
  checkFocusedTests,
  checkApiSnapshot,
  checkShows,
  checkDrift,
];

/** Run every rule over a snapshot. Pure; never writes. */
export function checkGrimoire(snapshot: GrimoireSnapshot): GrimoireCheckReport {
  const findings = [
    ...snapshot.structure,
    ...snapshot.proofFindings,
    ...CHECK_RULES.flatMap((rule) => rule(snapshot)),
    ...checkApps(snapshot),
    ...checkReleases(snapshot),
    ...checkTasks(snapshot),
    ...checkTestResults(snapshot),
    ...checkBookNotes(snapshot),
  ];

  return finishReport(snapshot, findings);
}

/**
 * Mark the findings on proposed features and flows as expected, sort them
 * and count them. The findings of the snapshot are copied, never changed.
 */
export function finishReport(
  snapshot: GrimoireSnapshot,
  findings: readonly GrimoireFinding[],
): GrimoireCheckReport {
  const proposed = proposedWork(snapshot);
  const marked = findings
    .map((finding) => ({ ...finding, expected: finding.expected || isProposed(finding, proposed) }))
    .sort(compareFindings);
  const unexpected = marked.filter((finding) => !finding.expected);
  const errors = unexpected.filter((finding) => finding.severity === "error").length;

  return {
    schemaVersion: 1,
    root: snapshot.root,
    findings: marked,
    counts: {
      errors,
      warnings: unexpected.length - errors,
      expected: marked.length - unexpected.length,
    },
    ok: errors === 0,
    routes: snapshot.routes,
  };
}

/** Feature ids and `<feature>/<flow>` refs whose status is `proposed`. */
function proposedWork(snapshot: GrimoireSnapshot): Set<string> {
  const proposed = new Set<string>();

  for (const feature of snapshot.written.features) {
    if (feature.readme?.status.value === "proposed") proposed.add(feature.id);

    for (const flow of feature.flows) {
      if (flow.status.value === "proposed") proposed.add(flow.ref);
    }
  }

  return proposed;
}

function isProposed(finding: GrimoireFinding, proposed: ReadonlySet<string>): boolean {
  const { feature, flow } = finding.subject;
  const flowFeature = flow?.split("/")[0] ?? null;

  return [feature, flow, flowFeature].some((id) => id !== null && proposed.has(id));
}

/** Unexpected findings first, then expected; within each, errors before warnings, then by file, line and code. */
function compareFindings(left: GrimoireFinding, right: GrimoireFinding): number {
  return (
    Number(left.expected) - Number(right.expected) ||
    severityRank(left) - severityRank(right) ||
    compareText(
      left.at?.file ?? left.subject.file ?? "",
      right.at?.file ?? right.subject.file ?? "",
    ) ||
    (left.at?.line ?? 0) - (right.at?.line ?? 0) ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message)
  );
}

function severityRank(finding: GrimoireFinding): number {
  return finding.severity === "error" ? 0 : 1;
}

/** Locale-free comparison, so the order is the same on every machine. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
