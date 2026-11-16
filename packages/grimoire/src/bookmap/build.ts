/**
 * Builds the book maps and the collected indexes in memory. Pure: reads only
 * its input.
 */
import type { BookFacts, BookFile } from "../contracts/adapter";
import { BOOK_SCHEMA_VERSION, type BookAnnotations, type BookManifest } from "../contracts/book";
import type {
  CollectedFiles,
  FeatureBookmap,
  FeaturesIndex,
  FlowBookmap,
  FlowBookmapCriterion,
  Ownership,
  TaskSummary,
  TasksIndex,
} from "../contracts/bookmap";
import type { AppMatch } from "../contracts/snapshot";
import type { ProofLine, ProofResult, TestResultsStore } from "../contracts/test-results";
import type {
  WrittenFeature,
  WrittenFlow,
  WrittenGrimoire,
  WrittenTask,
} from "../contracts/written";
import { fileGraph } from "../graph";
import { toPosixPath } from "../paths";
import { criterionStatus } from "../test-results";
import { resolveStep, type StepContext } from "./steps";

/** Everything the book maps are computed from. */
export type CollectedInput = {
  written: WrittenGrimoire;
  facts: BookFacts;
  ownership: Ownership;
  apps: Record<string, AppMatch>;
  proofs: ProofLine[];
  results: TestResultsStore | null;
  /** Test file → current sha256 (a result with another hash is stale). */
  testHashes: Record<string, string>;
};

/** The file name of a flow without `.md`: the name of its book map. */
export function flowFileId(flow: WrittenFlow): string {
  const name = toPosixPath(flow.file).split("/").pop() ?? flow.id.value;

  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

// ── Flow book maps ─────────────────────────────────────────────────────────

/**
 * The result recorded for the test a proof line points at: same file and
 * line, else (the test moved) same name among the results whose line no
 * proof of that file claims.
 */
function resultFor(
  proof: ProofLine,
  line: number,
  results: readonly ProofResult[],
  claimedLines: ReadonlySet<string>,
): ProofResult | null {
  const file = toPosixPath(proof.at.file);
  const sameProof = (result: ProofResult): boolean =>
    result.feature === proof.feature &&
    result.flow === proof.flow &&
    result.criterion === proof.criterion;
  const inFile = results.filter((result) => toPosixPath(result.testFile) === file);
  const atLine = inFile.filter((result) => result.line === line);
  const byLine = atLine.find(sameProof) ?? atLine[0];

  if (byLine) return byLine;

  const name = proof.test?.name ?? null;

  if (name === null) return null;

  const named = inFile.filter(
    (result) =>
      !claimedLines.has(`${file}:${result.line}`) &&
      (result.testName === name || result.testName.endsWith(` > ${name}`)),
  );

  return named.find(sameProof) ?? named[0] ?? null;
}

function flowCriteria(flow: WrittenFlow, input: CollectedInput): FlowBookmapCriterion[] {
  const results = input.results?.results ?? [];
  const claimedLines = new Set(
    input.proofs.flatMap((proof) =>
      proof.test === null ? [] : [`${toPosixPath(proof.at.file)}:${proof.test.line}`],
    ),
  );

  return flow.criteria.map((criterion) => {
    const tests = input.proofs
      .filter(
        (proof) =>
          proof.ref === flow.ref && proof.criterion === criterion.id && proof.test !== null,
      )
      .map((proof) => {
        const line = proof.test?.line ?? proof.at.line;
        const file = toPosixPath(proof.at.file);
        const result = resultFor(proof, line, results, claimedLines);
        const currentHash = input.testHashes[file];
        const stale =
          result !== null && currentHash !== undefined && result.testFileHash !== currentHash;

        return {
          file,
          line,
          name: proof.test?.name ?? null,
          result: result?.outcome ?? ("not-run" as const),
          stale,
        };
      })
      .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);

    return {
      id: criterion.id,
      app: criterion.app,
      text: criterion.text,
      tests,
      status: criterionStatus(tests),
    };
  });
}

function shownBy(flow: WrittenFlow, written: WrittenGrimoire): FlowBookmap["shownBy"] {
  const shown: FlowBookmap["shownBy"] = [];

  for (const app of written.apps) {
    const appId = app.id.value;

    for (const layout of app.layouts) {
      for (const row of layout.blocks) {
        if (row.flow === flow.ref) {
          shown.push({
            app: appId,
            type: "layout",
            id: layout.id,
            block: row.block,
            file: layout.file,
          });
        }
      }
    }

    for (const page of [...app.pages, ...app.screens]) {
      for (const row of page.blocks) {
        if (row.flow === flow.ref) {
          shown.push({
            app: appId,
            type: page.type,
            id: page.id,
            block: row.block,
            file: page.file,
          });
        }
      }
    }
  }

  return shown;
}

function flowBookmap(
  feature: WrittenFeature,
  flow: WrittenFlow,
  input: CollectedInput,
  context: StepContext,
): FlowBookmap {
  return {
    schemaVersion: BOOK_SCHEMA_VERSION,
    feature: feature.id,
    flow: flowFileId(flow),
    ref: flow.ref,
    steps: flow.steps.map((step) => resolveStep(step, feature, context)),
    criteria: flowCriteria(flow, input),
    shownBy: shownBy(flow, input.written),
  };
}

// ── Feature book maps ──────────────────────────────────────────────────────

function featureBookmap(
  feature: WrittenFeature,
  flows: readonly FlowBookmap[],
  input: CollectedInput,
  byPath: ReadonlyMap<string, BookFile>,
): FeatureBookmap {
  const { ownership, facts } = input;
  const own = ownership.features[feature.id]?.own ?? [];
  const ownSet = new Set(own);

  // Own files importing each file, from one pass over the own files' imports (`own` is sorted, so each list is too).
  const importersOf = new Map<string, string[]>();

  for (const ownFile of own) {
    for (const entry of byPath.get(ownFile)?.imports ?? []) {
      if (entry.file === null) continue;

      const list = importersOf.get(entry.file) ?? [];

      if (list.at(-1) !== ownFile) list.push(ownFile);
      importersOf.set(entry.file, list);
    }
  }

  const borrowed: FeatureBookmap["borrowed"] = (ownership.features[feature.id]?.borrowed ?? []).map(
    (file) => ({
      file,
      owner: ownership.files[file]?.owner ?? null,
      by: importersOf.get(file) ?? [],
    }),
  );

  const routes: FeatureBookmap["routes"] = [];

  for (const route of facts.routes ?? []) {
    if (route.isPage) continue;

    const file =
      route.handlerFile !== null && ownSet.has(route.handlerFile)
        ? route.handlerFile
        : route.sourceFile !== null && ownSet.has(route.sourceFile)
          ? route.sourceFile
          : null;

    if (file !== null)
      routes.push({ method: route.method, path: route.path, name: route.name, file });
  }

  const pages: FeatureBookmap["pages"] = {};
  const add = (app: string, item: FeatureBookmap["pages"][string][number]): void => {
    (pages[app] ??= []).push(item);
  };
  const appOfSite = new Map<string, string>();
  const appOfMobile = new Map<string, string>();

  for (const match of Object.values(input.apps)) {
    if (match.site && !appOfSite.has(match.site.id)) appOfSite.set(match.site.id, match.app);
    if (match.mobile && !appOfMobile.has(match.mobile.id))
      appOfMobile.set(match.mobile.id, match.app);
  }

  for (const page of facts.pages) {
    const owned = ownSet.has(page.file) || (page.setupFile !== null && ownSet.has(page.setupFile));

    if (owned)
      add(appOfSite.get(page.site) ?? page.site, {
        route: page.route,
        file: page.file,
        type: "page",
      });
  }

  for (const mobile of facts.mobile) {
    for (const screen of mobile.screens) {
      if (ownSet.has(screen.file)) {
        add(appOfMobile.get(mobile.id) ?? mobile.id, {
          route: screen.route,
          file: screen.file,
          type: "screen",
        });
      }
    }
  }

  const sortedPages: FeatureBookmap["pages"] = {};

  for (const app of Object.keys(pages).sort()) {
    sortedPages[app] = (pages[app] ?? []).sort(
      (left, right) => left.route.localeCompare(right.route) || left.file.localeCompare(right.file),
    );
  }

  const reached = new Set(flows.flatMap((flow) => flow.steps.flatMap((step) => step.files)));

  return {
    schemaVersion: BOOK_SCHEMA_VERSION,
    feature: feature.id,
    own,
    borrowed,
    routes,
    pages: sortedPages,
    unreached: own.filter((file) => !reached.has(file)),
  };
}

// ── Indexes ────────────────────────────────────────────────────────────────

function compareVersions(left: string, right: string): number {
  const [leftWhole = 0, leftDecimal = 0] = left.split(".").map(Number);
  const [rightWhole = 0, rightDecimal = 0] = right.split(".").map(Number);

  return leftWhole - rightWhole || leftDecimal - rightDecimal;
}

function featuresIndex(written: WrittenGrimoire): FeaturesIndex {
  const features: FeaturesIndex["features"] = [];

  for (const feature of [...written.features].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const readme = feature.readme;

    if (readme === null) continue;

    const releases = new Map<string, { version: string; release: string; date: string }>();

    for (const entry of feature.changelog?.entries ?? []) {
      if (entry.release === null || entry.date === null) continue;

      const version = entry.version.value;
      const known = releases.get(version);

      if (!known || entry.date > known.date) {
        releases.set(version, { version, release: entry.release, date: entry.date });
      }
    }

    features.push({
      id: feature.id,
      title: readme.title.value,
      status: readme.status.value,
      version: readme.version.value,
      updated: readme.updated.value,
      apps: readme.apps.map((app) => app.value),
      origin: readme.origin?.value ?? null,
      flows: feature.flows.map((flow) => ({
        id: flow.id.value,
        status: flow.status.value,
        since: flow.since.value,
      })),
      releases: [...releases.values()].sort(
        (left, right) =>
          right.date.localeCompare(left.date) || compareVersions(right.version, left.version),
      ),
    });
  }

  return { schemaVersion: BOOK_SCHEMA_VERSION, features };
}

function taskNumber(id: string): number {
  const match = /^T-(\d+)$/.exec(id);

  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function taskSummary(task: WrittenTask): TaskSummary {
  return {
    id: task.id.value,
    title: task.heading?.value ?? task.id.value,
    type: task.type.value,
    status: task.status.value,
    feature: task.feature?.value ?? null,
    flow: task.flow?.value ?? null,
    apps: task.apps.map((app) => app.value),
    file: task.file,
    shipped: task.shipped
      ? { feature: task.shipped.value.feature, version: task.shipped.value.version }
      : null,
    decisionNeeded: task.decisionNeeded,
  };
}

function tasksIndex(written: WrittenGrimoire): TasksIndex {
  const sorted = [...written.tasks].sort(
    (left, right) =>
      taskNumber(left.id.value) - taskNumber(right.id.value) ||
      left.id.value.localeCompare(right.id.value),
  );
  const open = sorted.filter((task) => task.folder === "open").map(taskSummary);

  return {
    schemaVersion: BOOK_SCHEMA_VERSION,
    open,
    waiting: open.filter(
      (task) => task.status === "waiting for approval" || task.decisionNeeded !== null,
    ),
    done: sorted.filter((task) => task.folder === "done").map(taskSummary),
  };
}

// ── Public ─────────────────────────────────────────────────────────────────

/** Every feature and flow book map, `features/index.json` and `tasks/index.json`. Pure. */
export function buildCollectedFiles(input: CollectedInput): CollectedFiles {
  const context: StepContext = {
    written: input.written,
    facts: input.facts,
    apps: input.apps,
    graph: fileGraph(input.facts.files),
  };
  const byPath = new Map(input.facts.files.map((file) => [file.file, file]));
  const features: CollectedFiles["features"] = {};
  const flows: CollectedFiles["flows"] = {};

  for (const feature of [...input.written.features].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const maps = feature.flows.map((flow) => flowBookmap(feature, flow, input, context));

    for (const map of maps) flows[map.ref] = map;

    features[feature.id] = featureBookmap(feature, maps, input, byPath);
  }

  return {
    features,
    flows,
    featuresIndex: featuresIndex(input.written),
    tasksIndex: tasksIndex(input.written),
  };
}

/** The per-file owner, borrowers and flows the book entries show. Pure. */
export function annotationsFrom(
  input: CollectedInput,
  collected: CollectedFiles,
  manifest: Pick<BookManifest, "tests">,
): BookAnnotations {
  const flowsOf = new Map<string, Set<string>>();

  for (const map of Object.values(collected.flows)) {
    for (const step of map.steps) {
      for (const file of step.files) {
        const set = flowsOf.get(file) ?? new Set<string>();
        set.add(map.ref);
        flowsOf.set(file, set);
      }
    }
  }

  const files: BookAnnotations["files"] = {};

  for (const file of input.facts.files) {
    const ownership = input.ownership.files[file.file];

    files[file.file] = {
      feature: ownership?.owner ?? null,
      borrowedBy: [...(ownership?.borrowedBy ?? [])],
      flows: [...(flowsOf.get(file.file) ?? [])].sort(),
    };
  }

  return { writtenHash: input.written.hash, tests: { ...manifest.tests }, files };
}
