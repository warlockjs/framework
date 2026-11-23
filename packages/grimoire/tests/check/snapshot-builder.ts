/**
 * Hand-built snapshots for the check's unit specs, so they never depend on
 * the parser, the book builder or the book maps.
 */
import type {
  BookFile,
  ChangeWord,
  FlowBookmap,
  FlowBookmapStep,
  GrimoireSnapshot,
  ProofLine,
  SourceLocation,
  StepType,
  WrittenChangelogEntry,
  WrittenCriterion,
  WrittenFeature,
  WrittenFlow,
  WrittenListLine,
  WrittenStatus,
  WrittenStep,
} from "../../src/contracts";

export const ROOT = "/project";

/** A location in a written file. */
export function at(file: string, line: number): SourceLocation {
  return { file, line, column: null };
}

function located<T>(value: T, file: string, line: number): { value: T; at: SourceLocation } {
  return { value, at: at(file, line) };
}

/** An empty snapshot of a project with a `grimoire/` folder, with `patch` applied. */
export function snapshot(patch: Partial<GrimoireSnapshot> = {}): GrimoireSnapshot {
  return {
    root: ROOT,
    written: {
      root: ROOT,
      exists: true,
      features: [],
      apps: [],
      tasks: [],
      releases: [],
      settings: null,
      hash: "",
    },
    structure: [],
    book: {
      root: ROOT,
      manifest: {
        schemaVersion: 1,
        grimoireVersion: "0.0.0",
        adapter: { name: "test", version: "0.0.0" },
        builtAt: "2026-11-16T00:00:00.000Z",
        sourceRoots: ["src"],
        files: {},
        tests: {},
        writtenHash: "",
        boot: { collectedAt: null, inputs: {} },
      },
      facts: { files: [], routes: [], sites: [], pages: [], mobile: [], named: [], tests: [] },
      routes: "fresh",
    },
    ownership: { files: {}, features: {} },
    apps: {},
    proofs: [],
    proofFindings: [],
    results: null,
    resultsFile: "grimoire/book/test-results.json",
    collected: {
      features: {},
      flows: {},
      featuresIndex: { schemaVersion: 1, features: [] },
      tasksIndex: { schemaVersion: 1, open: [], waiting: [], done: [] },
    },
    annotations: { writtenHash: "", tests: {}, files: {} },
    routes: "fresh",
    ...patch,
  };
}

/** Add apps (folders under `grimoire/apps/`) to a snapshot. */
export function withApps(target: GrimoireSnapshot, ids: readonly string[]): GrimoireSnapshot {
  target.written.apps = ids.map((id) => {
    const file = `grimoire/apps/${id}/README.md`;

    return {
      dir: `grimoire/apps/${id}`,
      file,
      id: located(id, file, 2),
      type: located("site" as const, file, 3),
      root: located(`src/web/$sites/${id}`, file, 4),
      origin: null,
      heading: null,
      conditions: [],
      layouts: [],
      pages: [],
      screens: [],
    };
  });

  return target;
}

export type FeatureInput = {
  status?: WrittenStatus;
  version?: string;
  updated?: string;
  apps?: string[];
  folders?: string[];
  relations?: string[];
  flows?: WrittenFlow[];
  entries?: Omit<WrittenChangelogEntry, "feature">[];
  versions?: number[];
  readme?: boolean;
};

/** A feature folder with a README (unless `readme: false`). */
export function feature(id: string, input: FeatureInput = {}): WrittenFeature {
  const file = `grimoire/features/${id}/README.md`;
  const changelogFile = `grimoire/features/${id}/CHANGELOG.md`;

  return {
    id,
    dir: `grimoire/features/${id}`,
    readme:
      input.readme === false
        ? null
        : {
            file,
            id: located(id, file, 2),
            title: located(id, file, 3),
            status: located(input.status ?? "shipped", file, 4),
            version: located(input.version ?? "1.0", file, 5),
            updated: located(input.updated ?? "2026-11-01", file, 6),
            apps: (input.apps ?? []).map((app) => located(app, file, 7)),
            folders: (input.folders ?? []).map((folder) => located(folder, file, 8)),
            origin: null,
            heading: null,
            summary: null,
            audience: [],
            why: null,
            flows: (input.flows ?? []).map((flow, index) =>
              listLine(flow.id.value, file, 15 + index),
            ),
            relations: (input.relations ?? []).map((ref, index) => ({
              text: `affects ${ref}`,
              refs: [ref],
              at: at(file, 20 + index),
            })),
          },
    changelog: input.entries
      ? {
          file: changelogFile,
          sections: [],
          entries: input.entries.map((entry) => ({ ...entry, feature: id })),
        }
      : null,
    flows: input.flows ?? [],
    versions: (input.versions ?? []).map((major) => ({
      file: `grimoire/features/${id}/versions/v${major}.md`,
      feature: id,
      major,
      heading: null,
    })),
  };
}

export type FlowInput = {
  since?: string;
  status?: WrittenStatus;
  steps?: ([StepType, string] | [StepType, string, string])[];
  differs?: string[];
  criteria?: (string | [string, string])[];
};

/** A flow file: steps as `[kind, target]`, criteria as `AC-n` or `[AC-n, app]`. */
export function flow(featureId: string, id: string, input: FlowInput = {}): WrittenFlow {
  const file = `grimoire/features/${featureId}/flows/${id}.md`;

  return {
    file,
    feature: featureId,
    id: located(id, file, 2),
    ref: `${featureId}/${id}`,
    since: located(input.since ?? "1.0", file, 3),
    status: located(input.status ?? "shipped", file, 4),
    who: located("customer", file, 5),
    origin: null,
    heading: null,
    summary: null,
    story: [],
    steps: (input.steps ?? []).map(([type, target, app], index) =>
      step(file, index + 1, type, target, app ?? null),
    ),
    differs: (input.differs ?? []).map((app, index) => listLine(app, file, 20 + index)),
    cases: [],
    notHandled: [],
    unknowns: [],
    screenshots: null,
    criteria: (input.criteria ?? []).map((value, index) => criterion(file, 30 + index, value)),
  };
}

function step(
  file: string,
  index: number,
  type: StepType,
  target: string,
  app: string | null,
): WrittenStep {
  const route = type === "route" ? /^(\S+)\s+(\S+)$/.exec(target) : null;
  const [affectsFeature = "", affectsFlow = null] = type === "affects" ? target.split("/") : [];

  return {
    index,
    type,
    target,
    app,
    route: route ? { method: route[1] ?? "", path: route[2] ?? "" } : null,
    affects: type === "affects" ? { feature: affectsFeature, flow: affectsFlow } : null,
    note: null,
    at: at(file, 10 + index),
  };
}

function criterion(file: string, line: number, value: string | [string, string]): WrittenCriterion {
  const [id, app]: [string, string | null] = typeof value === "string" ? [value, null] : value;

  return { id, number: Number(id.slice(3)), app, text: `criterion ${id}`, at: at(file, line) };
}

function listLine(name: string, file: string, line: number): WrittenListLine {
  return { name, text: `about ${name}`, at: at(file, line) };
}

/** A changelog entry (the feature id is filled by {@link feature}). */
export function entry(
  version: string,
  word: ChangeWord,
  options: {
    flow?: string;
    criteria?: string[];
    release?: string;
    date?: string;
    line?: number;
  } = {},
): Omit<WrittenChangelogEntry, "feature"> {
  const file = "grimoire/features/x/CHANGELOG.md";

  return {
    version: located(version, file, options.line ?? 2),
    word,
    flow: options.flow ?? null,
    criteria: options.criteria ?? [],
    text: "a change",
    release: options.release ?? null,
    date: options.date ?? null,
    at: at(file, options.line ?? 2),
  };
}

/** A flow book map whose steps are found or not, in step order. */
export function bookmap(target: WrittenFlow, found: (boolean | null)[]): FlowBookmap {
  return {
    schemaVersion: 1,
    feature: target.feature,
    flow: target.id.value,
    ref: target.ref,
    steps: target.steps.map((item, index): FlowBookmapStep => ({
      index: item.index,
      type: item.type,
      target: item.target,
      found: found[index] ?? true,
      entry: null,
      entries: [],
      direct: [],
      files: [],
      typeOnlyFiles: [],
    })),
    criteria: [],
    shownBy: [],
  };
}

/** A `@proves` line of a test file. */
export function proof(
  ref: string,
  criterion: string,
  file = "src/app/x/tests/x.test.ts",
  line = 3,
): ProofLine {
  const [featureId = "", flowId = ""] = ref.split("/");

  return {
    feature: featureId,
    flow: flowId,
    ref,
    criterion,
    test: { name: "a test", line: line + 1 },
    at: at(file, line),
  };
}

/** A code file as the adapter reports it. */
export function bookFile(file: string, patch: Partial<BookFile> = {}): BookFile {
  return {
    file,
    module: file.split("/").slice(0, 3).join("/"),
    type: "service",
    lines: 10,
    about: "Does one thing.",
    tags: {},
    exports: [],
    imports: [],
    importedBy: [],
    mobileApp: null,
    ...patch,
  };
}
