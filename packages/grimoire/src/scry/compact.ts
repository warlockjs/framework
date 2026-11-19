/**
 * The compact flow answer: a flow's steps as counts and the first direct
 * imports instead of every reachable file, plus what a flow page header needs
 * (feature, neighbours, health, test results). The devtools route
 * `GET /flows/:feature/:flow` and the MCP tool `grimoire_flow` both send it;
 * `scry()` itself keeps the full answer.
 */
import type { FlowBookmap, FlowBookmapStep } from "../contracts/bookmap";
import type { ScryFlowResult } from "../contracts/scry";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type { CriterionStatus } from "../contracts/test-results";
import type { WrittenFeature, WrittenFlow } from "../contracts/written";
import {
  FLOW_STEP_DIRECT_LIMIT,
  STEP_FILES_PAGE_LIMIT,
  type GrimoireFlowAnswer,
  type GrimoireFlowHealth,
  type GrimoireFlowNeighbour,
  type GrimoireFlowStep,
  type GrimoireStepFilesAnswer,
  type StepFileCounts,
  type StepFileSet,
} from "../devtools/answers";
import { testResultsInfo } from "../test-results";

/** The file sets a step can list, in the order a view shows them. */
export const STEP_FILE_SETS: readonly StepFileSet[] = [
  "direct",
  "feature",
  "reachable",
  "type-only",
];

const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** The files of a step the flow's feature owns. */
function featureFiles(
  snapshot: GrimoireSnapshot,
  feature: string,
  step: FlowBookmapStep,
): string[] {
  return step.files.filter((file) => snapshot.ownership.files[file]?.owner === feature);
}

/** How many files a step reaches, by set. */
export function stepCounts(
  snapshot: GrimoireSnapshot,
  feature: string,
  step: FlowBookmapStep,
): StepFileCounts {
  return {
    direct: step.direct.length,
    feature: featureFiles(snapshot, feature, step).length,
    reachable: step.files.length,
    typeOnly: step.typeOnlyFiles.length,
  };
}

/** The flows of a feature in the README's Flows order, else in file order. */
export function flowOrder(feature: WrittenFeature): WrittenFlow[] {
  const byId = new Map(feature.flows.map((flow) => [flow.id.value, flow]));
  const listed = (feature.readme?.flows ?? []).flatMap((line) => {
    const flow = byId.get(line.name);

    return flow === undefined ? [] : [flow];
  });

  if (listed.length === 0) return feature.flows;

  // A flow the README does not list follows the listed ones, in file order.
  const seen = new Set(listed);

  return [...listed, ...feature.flows.filter((flow) => !seen.has(flow))];
}

function neighbour(flow: WrittenFlow | undefined): GrimoireFlowNeighbour | null {
  return flow === undefined ? null : { id: flow.id.value, heading: flow.heading?.value ?? null };
}

/** The flow before and after `flowId` in its feature. */
export function neighboursOf(
  feature: WrittenFeature,
  flowId: string,
): { previous: GrimoireFlowNeighbour | null; next: GrimoireFlowNeighbour | null } {
  const order = flowOrder(feature);
  const position = order.findIndex((flow) => flow.id.value === flowId);

  if (position < 0) return { previous: null, next: null };

  return { previous: neighbour(order[position - 1]), next: neighbour(order[position + 1]) };
}

/** The health strip numbers of a flow (criteria, steps, findings). */
export function flowHealth(result: ScryFlowResult): GrimoireFlowHealth {
  const byStatus: Record<CriterionStatus, number> = {
    pass: 0,
    fail: 0,
    stale: 0,
    "not-run": 0,
    "no-test": 0,
  };

  for (const criterion of result.bookmap.criteria) byStatus[criterion.status] += 1;

  const checked = result.bookmap.steps.filter((step) => step.found !== null);
  const unexpected = result.findings.filter((finding) => !finding.expected);
  const errors = unexpected.filter((finding) => finding.severity === "error").length;

  return {
    criteria: { total: result.bookmap.criteria.length, proven: byStatus.pass, byStatus },
    steps: {
      total: checked.length,
      resolved: checked.filter((step) => step.found === true).length,
      unchecked: result.bookmap.steps.length - checked.length,
    },
    findings: {
      errors,
      warnings: unexpected.length - errors,
      expected: result.findings.length - unexpected.length,
    },
  };
}

/** One step with counts and the first direct imports; the file lists are left out. */
export function compactStep(
  snapshot: GrimoireSnapshot,
  feature: WrittenFeature,
  step: FlowBookmapStep,
  written: WrittenFlow | undefined,
): GrimoireFlowStep {
  const { files: _files, typeOnlyFiles: _typeOnly, direct, ...rest } = step;
  const target = written?.steps.find((item) => item.index === step.index)?.affects ?? null;
  let linked: GrimoireFlowStep["linked"] = null;

  if (target !== null && target.flow !== null) {
    const owner =
      target.feature === feature.id
        ? feature
        : snapshot.written.features.find((item) => item.id === target.feature);
    const other = owner?.flows.find((item) => item.id.value === target.flow);

    if (other !== undefined) {
      linked = { ref: other.ref, heading: other.heading?.value ?? null, summary: other.summary };
    }
  }

  return {
    ...rest,
    counts: stepCounts(snapshot, feature.id, step),
    direct: direct.slice(0, FLOW_STEP_DIRECT_LIMIT),
    linked,
  };
}

/** The scry flow answer made compact, with the flow page header data. */
export function compactFlow(
  snapshot: GrimoireSnapshot,
  result: ScryFlowResult,
): GrimoireFlowAnswer {
  const feature = snapshot.written.features.find((item) => item.id === result.flow.feature);

  if (feature === undefined) {
    throw new Error(`Feature ${result.flow.feature} is not written.`);
  }

  const readme = feature.readme;
  const { previous, next } = neighboursOf(feature, result.flow.id.value);

  return {
    ...result,
    bookmap: {
      ...result.bookmap,
      steps: result.bookmap.steps.map((step) => compactStep(snapshot, feature, step, result.flow)),
    },
    feature: {
      id: feature.id,
      title: readme?.title.value ?? feature.id,
      status: readme?.status.value ?? result.flow.status.value,
      apps: (readme?.apps ?? []).map((app) => app.value),
    },
    previous,
    next,
    health: flowHealth(result),
    results: testResultsInfo(snapshot),
  };
}

/** The files of one set of a step, sorted by module and then path. */
export function stepFileSet(
  snapshot: GrimoireSnapshot,
  feature: string,
  step: FlowBookmapStep,
  set: StepFileSet,
): string[] {
  const files =
    set === "direct"
      ? step.direct
      : set === "feature"
        ? featureFiles(snapshot, feature, step)
        : set === "reachable"
          ? step.files
          : step.typeOnlyFiles;
  const modules = new Map(snapshot.book.facts.files.map((item) => [item.file, item.module]));
  const moduleOf = (file: string): string => modules.get(file) ?? "";

  return [...files].sort(
    (left, right) => byText(moduleOf(left), moduleOf(right)) || byText(left, right),
  );
}

/**
 * One page of a step's files with the module counts of the whole set.
 * `limit` is capped at {@link STEP_FILES_PAGE_LIMIT}.
 */
export function stepFilePage(
  snapshot: GrimoireSnapshot,
  bookmap: FlowBookmap,
  step: FlowBookmapStep,
  set: StepFileSet,
  offset: number,
  limit: number,
): GrimoireStepFilesAnswer {
  const sorted = stepFileSet(snapshot, bookmap.feature, step, set);
  const modules = new Map(snapshot.book.facts.files.map((item) => [item.file, item.module]));
  const moduleOf = (file: string): string => modules.get(file) ?? "";
  const size = Math.min(Math.max(1, Math.floor(limit)), STEP_FILES_PAGE_LIMIT);
  const start = Math.max(0, Math.floor(offset));
  const counts = new Map<string, number>();

  for (const file of sorted) counts.set(moduleOf(file), (counts.get(moduleOf(file)) ?? 0) + 1);

  return {
    ref: bookmap.ref,
    index: step.index,
    set,
    total: sorted.length,
    offset: start,
    limit: size,
    files: sorted.slice(start, start + size).map((file) => ({
      file,
      module: moduleOf(file),
      owner: snapshot.ownership.files[file]?.owner ?? null,
    })),
    modules: [...counts]
      .map(([module, count]) => ({ module, count }))
      .sort((left, right) => right.count - left.count || byText(left.module, right.module)),
  };
}
