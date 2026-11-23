/**
 * `GET /matrix`: the bird-view. Every feature, flow and acceptance criterion
 * against the app's languages, built from the snapshot. Without `@shows`
 * scenes or an approved baseline it carries the test status only.
 */
import type { CriterionStatus } from "../contracts/test-results";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type {
  GrimoireMatrix,
  MatrixCell,
  MatrixCellState,
  MatrixCriterionRow,
  MatrixFeatureRow,
  MatrixFlowRow,
} from "../contracts/matrix";
import { DEFAULT_GRIMOIRE_SETTINGS } from "../contracts/settings";
import type { ApprovedFlow, DriftItem, ShotsState } from "../contracts/shots";
import type { WrittenFeature, WrittenFlow } from "../contracts/written";

/** The feature that is listed first: the project's design rules. */
const DESIGN_SYSTEM = "design-system";

/** Worst first: the state of a cell is the first of these that applies. */
const STATE_ORDER: readonly MatrixCellState[] = [
  "rejected",
  "fail",
  "changed",
  "stale",
  "not-run",
  "no-test",
  "pass",
];

/** What the route answers: the matrix, and whether this panel may write approvals. */
export type GrimoireMatrixAnswer = GrimoireMatrix & {
  /** `true` in development, where Approve and Reject work; `false` in production and in a static export. */
  development: boolean;
};

type Inputs = {
  languages: string[];
  shots: ShotsState | null;
  captured: Map<string, NonNullable<ShotsState["captures"]>["captures"][number]>;
  approved: Map<string, string>;
  /** The screenshot mode of this run (`changed`, `all` or `off`). */
  mode: string;
  driftOf: (ref: string, criterion: string | null, language: string | null) => DriftItem[];
};

const cellKey = (ref: string, criterion: string, language: string): string =>
  `${ref}\n${criterion}\n${language}`;

function inputsOf(snapshot: GrimoireSnapshot): Inputs {
  const settings = snapshot.settings ?? DEFAULT_GRIMOIRE_SETTINGS;
  const shots = snapshot.shots ?? null;
  const captured = new Map<string, NonNullable<ShotsState["captures"]>["captures"][number]>();
  const approved = new Map<string, string>();
  const drift = shots?.drift ?? [];

  for (const capture of shots?.captures?.captures ?? []) {
    captured.set(cellKey(capture.ref, capture.criterion, capture.language), capture);
  }

  for (const shot of shots?.baseline?.shots ?? []) {
    approved.set(cellKey(shot.ref, shot.criterion, shot.language), shot.file);
  }

  return {
    languages: settings.languages.length > 0 ? [...settings.languages] : [""],
    shots,
    captured,
    approved,
    mode: shots?.mode ?? settings.screenshots,
    // A drift item without a language (a changed criterion text, a removed proof) concerns every language of the criterion.
    driftOf: (ref, criterion, language) =>
      drift.filter(
        (item) =>
          item.ref === ref &&
          item.criterion === criterion &&
          (criterion === null ||
            language === null ||
            item.language === null ||
            item.language === language),
      ),
  };
}

function worst(states: readonly MatrixCellState[]): MatrixCellState {
  return STATE_ORDER.find((state) => states.includes(state)) ?? "pass";
}

type CellInput = {
  ref: string;
  criterion: string;
  language: string;
  test: CriterionStatus;
  /** `true` when a `@shows` scene names the criterion. */
  shows: boolean;
  /** `true` for a criterion that is no longer written. */
  removed: boolean;
};

function cellOf(inputs: Inputs, input: CellInput): MatrixCell {
  const { ref, criterion, language } = input;
  const key = cellKey(ref, criterion, language);
  const capture = inputs.captured.get(key) ?? null;
  const approvedFile = inputs.approved.get(key) ?? null;
  const items = inputs.driftOf(ref, criterion, language);
  const baseline = inputs.shots?.baseline ?? null;
  // In `changed` mode only touched flows are captured: with no capture, an approved image still stands.
  const standing = capture === null && approvedFile !== null && inputs.mode !== "all";
  const shown: MatrixCell["shown"] =
    input.shows || (input.removed && approvedFile !== null)
      ? {
          outcome: capture?.outcome ?? (standing && !input.removed ? "pass" : "not-run"),
          shot: capture?.file ?? null,
          approved: approvedFile,
          ranAt: capture?.ranAt ?? null,
        }
      : null;
  const approval: MatrixCell["approval"] =
    baseline === null
      ? null
      : items.some((item) => item.rejected !== null)
        ? "rejected"
        : items.length > 0 || input.removed
          ? "changed"
          : "approved";
  const states: MatrixCellState[] = [];

  if (approval === "rejected") states.push("rejected");

  if (input.test === "fail" || shown?.outcome === "fail") states.push("fail");

  if (approval === "changed") states.push("changed");

  // A removed criterion has no test to speak of: it is a change until approved.
  if (!input.removed) {
    if (input.test === "stale") states.push("stale");

    if (input.test === "not-run" || shown?.outcome === "not-run") states.push("not-run");

    if (input.test === "no-test") states.push("no-test");
  }

  return {
    language,
    test: input.test,
    shown,
    approval,
    drift: items.map((item) => item.id),
    state: worst(states),
  };
}

function removedCriteria(
  inputs: Inputs,
  ref: string,
  approvedFlow: ApprovedFlow,
  written: ReadonlySet<string>,
): MatrixCriterionRow[] {
  return approvedFlow.criteria
    .filter((criterion) => !written.has(criterion.id))
    .map((criterion) => ({
      id: criterion.id,
      text: criterion.text,
      app: null,
      removed: true,
      cells: inputs.languages.map((language) =>
        cellOf(inputs, {
          ref,
          criterion: criterion.id,
          language,
          test: "no-test",
          shows: false,
          removed: true,
        }),
      ),
    }));
}

function flowRow(snapshot: GrimoireSnapshot, inputs: Inputs, flow: WrittenFlow): MatrixFlowRow {
  const bookmap = snapshot.collected.flows[flow.ref];
  const status = new Map((bookmap?.criteria ?? []).map((item) => [item.id, item.status]));
  const shows = new Set(
    (inputs.shots?.shows ?? [])
      .filter((line) => line.ref === flow.ref)
      .map((line) => line.criterion),
  );
  const approvedFlow = inputs.shots?.baseline?.flows.find((item) => item.ref === flow.ref);
  const writtenIds = new Set(flow.criteria.map((criterion) => criterion.id));
  const optedOut =
    flow.screenshots?.value === false || (inputs.shots?.optedOut ?? []).includes(flow.ref);

  return {
    ref: flow.ref,
    id: flow.id.value,
    title: flow.heading?.value ?? flow.id.value,
    status: flow.status.value,
    differsIn: flow.differs.map((line) => line.name),
    screenshots: !optedOut,
    removed: false,
    criteria: [
      ...flow.criteria.map((criterion) => ({
        id: criterion.id,
        text: criterion.text,
        app: criterion.app,
        removed: false,
        cells: inputs.languages.map((language) =>
          cellOf(inputs, {
            ref: flow.ref,
            criterion: criterion.id,
            language,
            test: status.get(criterion.id) ?? "no-test",
            // A flow with no screenshots (opted out, or the mode is off) never waits for a capture.
            shows: !optedOut && inputs.mode !== "off" && shows.has(criterion.id),
            removed: false,
          }),
        ),
      })),
      ...(approvedFlow === undefined
        ? []
        : removedCriteria(inputs, flow.ref, approvedFlow, writtenIds)),
    ],
    drift: inputs.driftOf(flow.ref, null, null).map((item) => item.id),
  };
}

function featureRow(
  snapshot: GrimoireSnapshot,
  inputs: Inputs,
  feature: WrittenFeature,
): MatrixFeatureRow {
  return {
    id: feature.id,
    title: feature.readme?.title.value ?? feature.id,
    designSystem: feature.id === DESIGN_SYSTEM,
    flows: feature.flows.map((flow) => flowRow(snapshot, inputs, flow)),
  };
}

/** Rows of the baseline that are no longer written: whole flows, and the features only they belonged to. */
function removedFlows(
  inputs: Inputs,
  features: MatrixFeatureRow[],
  snapshot: GrimoireSnapshot,
): void {
  const written = new Set(
    snapshot.written.features.flatMap((feature) => feature.flows.map((flow) => flow.ref)),
  );

  for (const approved of inputs.shots?.baseline?.flows ?? []) {
    if (written.has(approved.ref)) continue;

    const [featureId = "", flowId = ""] = approved.ref.split("/");
    let feature = features.find((item) => item.id === featureId);

    if (feature === undefined) {
      feature = {
        id: featureId,
        title: featureId,
        designSystem: featureId === DESIGN_SYSTEM,
        flows: [],
      };
      features.push(feature);
    }

    const flowDrift = inputs.driftOf(approved.ref, null, null).map((item) => item.id);
    // The flow's removal is the change each of its cells stands for: approving a cell approves the removal.
    const criteria = removedCriteria(inputs, approved.ref, approved, new Set()).map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        ...cell,
        drift: [...new Set([...flowDrift, ...cell.drift])],
      })),
    }));

    feature.flows.push({
      ref: approved.ref,
      id: flowId,
      title: flowId,
      status: null,
      differsIn: [],
      screenshots: true,
      removed: true,
      criteria,
      drift: flowDrift,
    });
  }
}

/** `GET /matrix`. */
export function matrix(snapshot: GrimoireSnapshot): GrimoireMatrix {
  const inputs = inputsOf(snapshot);
  const settings = snapshot.settings ?? DEFAULT_GRIMOIRE_SETTINGS;
  const features = snapshot.written.features.map((feature) =>
    featureRow(snapshot, inputs, feature),
  );

  removedFlows(inputs, features, snapshot);

  // The design system first; the rest keep their order.
  features.sort((left, right) => Number(right.designSystem) - Number(left.designSystem));

  const counts: GrimoireMatrix["counts"] = {
    rejected: 0,
    fail: 0,
    changed: 0,
    stale: 0,
    "not-run": 0,
    "no-test": 0,
    pass: 0,
  };

  for (const feature of features)
    for (const flow of feature.flows)
      for (const criterion of flow.criteria)
        for (const cell of criterion.cells) counts[cell.state] += 1;

  const baseline = inputs.shots?.baseline ?? null;

  return {
    languages: inputs.languages,
    mode: inputs.shots?.mode ?? settings.screenshots,
    baseline: baseline === null ? null : { approvedAt: baseline.approvedAt },
    features,
    drift: inputs.shots?.drift ?? [],
    counts,
  };
}

/** What needs a look in the bird-view: cells that failed, changed or were rejected, and the changes to whole flows. */
export function attentionOf(answer: GrimoireMatrix): number {
  const flows = answer.features.reduce(
    (total, feature) => total + feature.flows.reduce((sum, flow) => sum + flow.drift.length, 0),
    0,
  );

  return answer.counts.fail + answer.counts.changed + answer.counts.rejected + flows;
}

/** Every image the matrix shows (captured and approved), as paths under `grimoire/screenshots/`, once each. */
export function matrixImagePaths(answer: GrimoireMatrix): string[] {
  const found = new Set<string>();

  for (const feature of answer.features)
    for (const flow of feature.flows)
      for (const criterion of flow.criteria)
        for (const cell of criterion.cells) {
          if (cell.shown?.shot) found.add(cell.shown.shot);

          if (cell.shown?.approved) found.add(cell.shown.approved);
        }

  return [...found].sort();
}
