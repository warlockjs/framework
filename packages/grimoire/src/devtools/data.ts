/**
 * The answers of the tab, as functions of the snapshot. The devtools routes
 * and the static export both call them; questions about one item go to
 * `scry()`, the rest read the snapshot directly.
 */
import { explainGrimoireCode, isGrimoireCode } from "../codes";
import { checkGrimoire } from "../check";
import type { BookHost, BookPage, BookScreen } from "../contracts/adapter";
import type { TasksIndex, FeaturesIndex } from "../contracts/bookmap";
import type { GrimoireCheckReport, GrimoireFinding, RouteFreshness } from "../contracts/findings";
import type {
  ScryFeatureResult,
  ScryFileResult,
  ScryFlowResult,
  ScryImpactResult,
  ScryRouteResult,
  ScrySearchResult,
} from "../contracts/scry";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type { WrittenApp, WrittenLayout, WrittenPage, WrittenRelease } from "../contracts/written";
import { scry } from "../scry";
import { compactFlow, STEP_FILE_SETS, stepFilePage } from "../scry/compact";
import { testResultsInfo } from "../test-results";
import { featureFileGroups, featureMap, featureProofs } from "./feature-map";
import { featureGraph, fileGraph, moduleGraph, pageGraph, type GrimoireGraph } from "./graphs";
import {
  STEP_FILES_PAGE_LIMIT,
  type GrimoireFeatureAnswer,
  type GrimoireCheckFilter,
  type GrimoireCheckGroup,
  type GrimoireCheckGroups,
  type GrimoireCheckPage,
  type GrimoireFlowAnswer,
  type GrimoireStepFilesAnswer,
  type StepFileSet,
} from "./answers";
import type { TestResultsInfo } from "../contracts/test-results";

/** An error a route answers with a status (devtools turns `statusCode` into the response status). */
export class GrimoirePanelError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.name = "GrimoirePanelError";
    this.statusCode = statusCode;
  }
}

export type GrimoireSummary = {
  /**
   * Flow steps by what was checked: `resolved` (`found === true`) and `missing` (`found === false`) were looked up
   * in the code; `unchecked` (`found === null`, no route facts yet) were not, and never count against the health.
   */
  steps: { checked: number; resolved: number; missing: number; unchecked: number };
  routes: RouteFreshness;
  features: FeaturesIndex;
  tasks: TasksIndex;
  counts: GrimoireCheckReport["counts"];
  /** Whether any feature, app, task or release is written, and how big the book is. */
  written: boolean;
  book: { files: number; modules: number; builtAt: string };
  /** How many apps, pages, screens and releases are written (the tab's navigation and overview badges). */
  apps: { apps: number; pages: number; screens: number };
  releases: number;
  /** Whether test results were read, from where, and how many proofs have one. */
  results: TestResultsInfo;
  /** Framework brand and the app's name and version from the adapter; `null` when the adapter reports none. */
  host: BookHost | null;
};

/** One feature of the listing: the index entry plus what the cards show. */
export type GrimoireFeatureRow = Omit<FeaturesIndex["features"][number], "flows"> & {
  /** The README paragraph under the heading, or `null`. */
  summary: string | null;
  /** The index flows with their headings. */
  flows: (FeaturesIndex["features"][number]["flows"][number] & { heading: string | null })[];
};

export type GrimoireFeaturesAnswer = { features: GrimoireFeatureRow[] };

/** One page or screen of an app, as the listing shows it. */
export type GrimoireAppRow = {
  id: string;
  type: "page" | "screen";
  /** The page route or the screen name, or `null` when the file gives none. */
  route: string | null;
  heading: string | null;
  /** `confirmed` or `inferred` when the file says so, otherwise `null`. */
  origin: "confirmed" | "inferred" | null;
  layout: string | null;
  /** How many block rows the page lists itself. */
  blocks: number;
};

export type GrimoireAppsAnswer = {
  apps: {
    id: string;
    type: string;
    root: string;
    pages: string[];
    screens: string[];
    /** Every page and screen with what the listing needs. */
    rows: GrimoireAppRow[];
  }[];
};

export type GrimoirePageAnswer = {
  page: WrittenPage;
  layout: WrittenLayout | null;
  book: BookPage | BookScreen | null;
};

export type GrimoireReleasesAnswer = {
  releases: { release: string; date: string; file: string }[];
};

/** `scry()` with its not-found codes turned into a 404 and the rest into a 400. */
function ask<Result>(snapshot: GrimoireSnapshot, query: Parameters<typeof scry>[1]): Result {
  try {
    return scry(snapshot, query) as Result;
  } catch (error) {
    const code = (error as { code?: unknown }).code;

    if (typeof code === "string" && isGrimoireCode(code)) {
      throw new GrimoirePanelError(code === "GR9006" ? 400 : 404, (error as Error).message);
    }

    throw error;
  }
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value === "") throw new GrimoirePanelError(400, `Missing "${name}".`);

  return value;
}

export function summary(snapshot: GrimoireSnapshot): GrimoireSummary {
  const files = snapshot.book.facts.files;
  const written = snapshot.written;

  const steps = Object.values(snapshot.collected.flows).flatMap((flow) => flow.steps);
  const resolved = steps.filter((step) => step.found === true).length;
  const missing = steps.filter((step) => step.found === false).length;

  return {
    steps: {
      checked: resolved + missing,
      resolved,
      missing,
      unchecked: steps.length - resolved - missing,
    },
    routes: snapshot.routes,
    features: snapshot.collected.featuresIndex,
    tasks: snapshot.collected.tasksIndex,
    counts: checkGrimoire(snapshot).counts,
    written: [written.features, written.apps, written.tasks, written.releases].some(
      (items) => items.length > 0,
    ),
    book: {
      files: files.length,
      modules: new Set(files.map((file) => file.module)).size,
      builtAt: snapshot.book.manifest.builtAt,
    },
    apps: {
      apps: written.apps.length,
      pages: written.apps.reduce((total, app) => total + app.pages.length, 0),
      screens: written.apps.reduce((total, app) => total + app.screens.length, 0),
    },
    releases: written.releases.length,
    results: testResultsInfo(snapshot),
    host: snapshot.host ?? null,
  };
}

/** The features listing: the features index with each README summary and flow headings. */
export function features(snapshot: GrimoireSnapshot): GrimoireFeaturesAnswer {
  const written = new Map(snapshot.written.features.map((feature) => [feature.id, feature]));

  return {
    features: snapshot.collected.featuresIndex.features.map((entry) => {
      const source = written.get(entry.id);
      const headings = new Map(
        (source?.flows ?? []).map((flow) => [flow.id.value, flow.heading?.value ?? null]),
      );

      return {
        ...entry,
        summary: source?.readme?.summary ?? null,
        flows: entry.flows.map((flow) => ({ ...flow, heading: headings.get(flow.id) ?? null })),
      };
    }),
  };
}

export function search(snapshot: GrimoireSnapshot, text: string, limit?: number): ScrySearchResult {
  return ask<ScrySearchResult>(snapshot, {
    type: "search",
    text,
    ...(limit !== undefined && Number.isFinite(limit) && limit > 0
      ? { limit: Math.min(limit, 100) }
      : {}),
  });
}

export function file(snapshot: GrimoireSnapshot, path: string | undefined): ScryFileResult {
  return ask(snapshot, { type: "file", file: required(path, "path") });
}

export function impact(snapshot: GrimoireSnapshot, path: string | undefined): ScryImpactResult {
  return ask(snapshot, { type: "impact", file: required(path, "path") });
}

export function route(
  snapshot: GrimoireSnapshot,
  method: string | undefined,
  path: string | undefined,
): ScryRouteResult {
  return ask(snapshot, {
    type: "route",
    method: required(method, "method"),
    path: required(path, "path"),
  });
}

export function feature(snapshot: GrimoireSnapshot, id: string | undefined): GrimoireFeatureAnswer {
  const wanted = required(id, "feature");
  const result = ask<ScryFeatureResult>(snapshot, { type: "feature", feature: wanted });
  const written = snapshot.written.features.find((item) => item.id === wanted);

  if (written === undefined)
    throw new GrimoirePanelError(404, `No feature "${wanted}" is written.`);

  return {
    ...result,
    map: featureMap(snapshot, written),
    fileGroups: featureFileGroups(snapshot, result.bookmap.own),
    proofs: featureProofs(snapshot, written),
  };
}

export function flow(
  snapshot: GrimoireSnapshot,
  featureId: string | undefined,
  flowId: string | undefined,
): ScryFlowResult {
  return ask(snapshot, {
    type: "flow",
    feature: required(featureId, "feature"),
    flow: required(flowId, "flow"),
  });
}

export function apps(snapshot: GrimoireSnapshot): GrimoireAppsAnswer {
  return {
    apps: snapshot.written.apps.map((app) => ({
      id: app.id.value,
      type: app.type.value,
      root: app.root.value,
      pages: app.pages.map((page) => page.id),
      screens: app.screens.map((screen) => screen.id),
      rows: [...app.pages, ...app.screens].map((item) => ({
        id: item.id,
        type: item.type,
        route: item.route?.value ?? item.screen?.value ?? null,
        heading: item.heading?.value ?? null,
        origin: item.origin?.value ?? null,
        layout: item.layout?.value ?? null,
        blocks: item.blocks.length,
      })),
    })),
  };
}

function findApp(snapshot: GrimoireSnapshot, id: string | undefined): WrittenApp {
  const app = snapshot.written.apps.find((candidate) => candidate.id.value === id);

  if (app === undefined)
    throw new GrimoirePanelError(404, `No app "${id ?? ""}" is written in grimoire/apps.`);

  return app;
}

/** A page or screen by its id or its route. */
export function findPage(app: WrittenApp, key: string): WrittenPage | undefined {
  return [...app.pages, ...app.screens].find(
    (page) => page.id === key || page.route?.value === key || page.screen?.value === key,
  );
}

export function page(
  snapshot: GrimoireSnapshot,
  appId: string | undefined,
  key: string | undefined,
): GrimoirePageAnswer {
  const app = findApp(snapshot, appId);
  const written = findPage(app, required(key, "page"));

  if (written === undefined) {
    throw new GrimoirePanelError(
      404,
      `App "${app.id.value}" has no page or screen "${key ?? ""}".`,
    );
  }

  const match = snapshot.apps[app.id.value];
  const route = written.route?.value ?? written.screen?.value ?? null;
  let book: BookPage | BookScreen | null = null;

  if (route !== null && match?.site) {
    book =
      snapshot.book.facts.pages.find(
        (candidate) => candidate.site === match.site?.id && candidate.route === route,
      ) ?? null;
  } else if (route !== null && match?.mobile) {
    book = match.mobile.screens.find((screen) => screen.route === route) ?? null;
  }

  const layoutId = written.layout?.value ?? null;

  return {
    page: written,
    layout:
      layoutId === null ? null : (app.layouts.find((layout) => layout.id === layoutId) ?? null),
    book,
  };
}

export function tasks(snapshot: GrimoireSnapshot): TasksIndex {
  return snapshot.collected.tasksIndex;
}

export function releases(snapshot: GrimoireSnapshot): GrimoireReleasesAnswer {
  return {
    releases: snapshot.written.releases.map((release) => ({
      release: release.release.value,
      date: release.date.value,
      file: release.file,
    })),
  };
}

export function release(snapshot: GrimoireSnapshot, id: string | undefined): WrittenRelease {
  const found = snapshot.written.releases.find((candidate) => candidate.release.value === id);

  if (found === undefined)
    throw new GrimoirePanelError(404, `No release "${id ?? ""}" in grimoire/releases.`);

  return found;
}

export function check(snapshot: GrimoireSnapshot): GrimoireCheckReport {
  return checkGrimoire(snapshot);
}

function graphOrNotFound(graph: GrimoireGraph | null, what: string): GrimoireGraph {
  if (graph === null) throw new GrimoirePanelError(404, `${what} is not in the book.`);

  return graph;
}

export function graphOfFile(snapshot: GrimoireSnapshot, path: string | undefined): GrimoireGraph {
  const target = required(path, "path");

  return graphOrNotFound(fileGraph(snapshot, target), `"${target}"`);
}

export function graphOfFeature(snapshot: GrimoireSnapshot, id: string | undefined): GrimoireGraph {
  const target = required(id, "feature");

  return graphOrNotFound(featureGraph(snapshot, target), `Feature "${target}"`);
}

export function graphOfPage(
  snapshot: GrimoireSnapshot,
  appId: string | undefined,
  key: string | undefined,
): GrimoireGraph {
  const target = required(key, "page");

  return graphOrNotFound(pageGraph(snapshot, required(appId, "app"), target), `Page "${target}"`);
}

export function graphOfModules(snapshot: GrimoireSnapshot): GrimoireGraph {
  return moduleGraph(snapshot);
}

// ── Compact flow, step files, check pages and groups ───────────────────────

/** `GET /flows/:feature/:flow`: the compact flow answer (step counts, direct imports, health, neighbours). */
export function flowAnswer(
  snapshot: GrimoireSnapshot,
  featureId: string | undefined,
  flowId: string | undefined,
): GrimoireFlowAnswer {
  return compactFlow(snapshot, flow(snapshot, featureId, flowId));
}

/** A whole number from a query value, or a 400 naming the parameter. */
function whole(value: string | undefined, name: string, fallback: number, min: number): number {
  if (value === undefined || value === "") return fallback;

  const number = Number(value);

  if (!Number.isInteger(number) || number < min) {
    throw new GrimoirePanelError(400, `"${name}" must be a whole number of ${min} or more.`);
  }

  return number;
}

/** `GET /flows/:feature/:flow/steps/:index/files`: one page of a step's files. */
export function stepFiles(
  snapshot: GrimoireSnapshot,
  featureId: string | undefined,
  flowId: string | undefined,
  index: string | undefined,
  query: { set?: string | undefined; offset?: string | undefined; limit?: string | undefined },
): GrimoireStepFilesAnswer {
  const feature = required(featureId, "feature");
  const id = required(flowId, "flow");
  const set = query.set === undefined || query.set === "" ? "reachable" : query.set;

  if (!(STEP_FILE_SETS as readonly string[]).includes(set)) {
    throw new GrimoirePanelError(
      400,
      `Unknown set "${set}". Use one of: ${STEP_FILE_SETS.join(", ")}.`,
    );
  }

  const stepIndex = whole(required(index, "index"), "index", 0, 0);
  const offset = whole(query.offset, "offset", 0, 0);
  const limit = Math.min(
    whole(query.limit, "limit", STEP_FILES_PAGE_LIMIT, 1),
    STEP_FILES_PAGE_LIMIT,
  );
  const written = snapshot.written.features
    .find((item) => item.id === feature)
    ?.flows.find((item) => item.id.value === id);
  const bookmap = written === undefined ? undefined : snapshot.collected.flows[written.ref];

  if (written === undefined || bookmap === undefined) {
    throw new GrimoirePanelError(404, `No flow ${feature}/${id} is written.`);
  }

  const step = bookmap.steps.find((item) => item.index === stepIndex);

  if (step === undefined) {
    throw new GrimoirePanelError(404, `${written.ref} has no step ${stepIndex}.`);
  }

  return stepFilePage(snapshot, bookmap, step, set as StepFileSet, offset, limit);
}

/** `GET /check?code=&feature=&flow=&severity=&state=&offset=&limit=`: matching findings, paged. */
export function checkPage(
  snapshot: GrimoireSnapshot,
  filter: GrimoireCheckFilter,
): GrimoireCheckPage {
  const report = checkGrimoire(snapshot);
  const limit = Math.min(Math.max(1, Math.floor(filter.limit ?? 100)), 500);
  const offset = Math.max(0, Math.floor(filter.offset ?? 0));
  const code = filter.code?.trim().toUpperCase();
  const matching = report.findings.filter((finding) => {
    if (code !== undefined && code !== "" && finding.code !== code) return false;
    if (filter.severity !== undefined && finding.severity !== filter.severity) return false;
    if (filter.state !== undefined && finding.expected !== (filter.state === "expected"))
      return false;
    if (filter.flow !== undefined && filter.flow !== "" && finding.subject.flow !== filter.flow) {
      return false;
    }

    if (filter.feature !== undefined && filter.feature !== "") {
      return featureOfFinding(finding) === filter.feature;
    }

    return true;
  });

  return {
    ...report,
    findings: matching.slice(offset, offset + limit),
    total: matching.length,
    offset,
    limit,
  };
}

/** The feature a finding belongs to: its subject, else the feature of its flow, else `(none)`. */
function featureOfFinding(finding: GrimoireFinding): string {
  return finding.subject.feature ?? finding.subject.flow?.split("/")[0] ?? "(none)";
}

/** `GET /check/groups`: the check by code, errors first, then by count. */
export function checkGroups(snapshot: GrimoireSnapshot): GrimoireCheckGroups {
  const report = checkGrimoire(snapshot);
  const byCode = new Map<string, GrimoireFinding[]>();

  for (const finding of report.findings) {
    byCode.set(finding.code, [...(byCode.get(finding.code) ?? []), finding]);
  }

  const groups: GrimoireCheckGroup[] = [];

  for (const [code, findings] of byCode) {
    const definition = explainGrimoireCode(code);
    const unexpected = findings.filter((finding) => !finding.expected);
    const features = new Map<string, number>();

    for (const finding of unexpected) {
      const feature = featureOfFinding(finding);

      features.set(feature, (features.get(feature) ?? 0) + 1);
    }

    groups.push({
      code,
      severity: findings[0]?.severity ?? definition?.severity ?? "warning",
      area: definition?.area ?? "",
      title: definition?.title ?? code,
      fix: definition?.fix ?? findings[0]?.hint ?? "",
      count: unexpected.length,
      expected: findings.length - unexpected.length,
      features: [...features]
        .map(([feature, count]) => ({ feature, count }))
        .sort((left, right) => right.count - left.count || (left.feature < right.feature ? -1 : 1)),
    });
  }

  groups.sort(
    (left, right) =>
      (left.severity === right.severity ? 0 : left.severity === "error" ? -1 : 1) ||
      right.count - left.count ||
      (left.code < right.code ? -1 : 1),
  );

  return { counts: report.counts, ok: report.ok, groups };
}
