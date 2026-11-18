/**
 * The shapes of the Grimoire tab's newer data routes: the compact flow
 * answer (counts first, file lists on request), the check groups, and the
 * product map. `data.ts` and `product-map.ts` build them; the browser views
 * (`ui/grimoire-view.js`, `ui/product-map.js`) read them; the static export
 * stores them.
 *
 * Absent values are `null`, never `undefined`.
 */
import type { BookRouteRef } from "../contracts/book";
import type { FlowBookmap, FlowBookmapCriterion, FlowBookmapStep } from "../contracts/bookmap";
import type { GrimoireCheckReport, GrimoireFinding } from "../contracts/findings";
import type { ScryFlowResult } from "../contracts/scry";
import type { CriterionStatus, TestResultsInfo } from "../contracts/test-results";
import type {
  ChangeWord,
  CriterionId,
  FeatureVersion,
  FlowRef,
  TaskStatus,
  TaskType,
  WrittenOrigin,
  WrittenStatus,
} from "../contracts/written";

// ── Flow page ──────────────────────────────────────────────────────────────

/** How many files a step reaches, by set. `feature` counts `files` the flow's feature owns. */
export type StepFileCounts = {
  direct: number;
  feature: number;
  reachable: number;
  typeOnly: number;
};

/** One step as the flow answer sends it: counts and the direct imports, never the whole reach. */
export type GrimoireFlowStep = Omit<FlowBookmapStep, "files" | "typeOnlyFiles" | "direct"> & {
  counts: StepFileCounts;
  /** The direct imports, at most {@link FLOW_STEP_DIRECT_LIMIT}; `counts.direct` has the full number. */
  direct: string[];
  /** For an `affects` step naming a flow: that flow and its heading. `null` otherwise. */
  linked: { ref: FlowRef; heading: string | null; summary: string | null } | null;
};

/** The most direct imports a flow answer lists per step. */
export const FLOW_STEP_DIRECT_LIMIT = 50;

/** A flow next to another in the README's Flows list. */
export type GrimoireFlowNeighbour = { id: string; heading: string | null };

/** The health strip of a flow page. */
export type GrimoireFlowHealth = {
  criteria: { total: number; proven: number; byStatus: Record<CriterionStatus, number> };
  steps: { total: number; resolved: number };
  findings: GrimoireCheckReport["counts"];
};

/**
 * `GET /flows/:feature/:flow`: the scry flow answer with the book map's steps
 * made compact, plus what the page header needs.
 */
export type GrimoireFlowAnswer = Omit<ScryFlowResult, "bookmap"> & {
  bookmap: Omit<FlowBookmap, "steps"> & { steps: GrimoireFlowStep[] };
  feature: { id: string; title: string; status: WrittenStatus; apps: string[] };
  previous: GrimoireFlowNeighbour | null;
  next: GrimoireFlowNeighbour | null;
  health: GrimoireFlowHealth;
  results: TestResultsInfo;
};

/** Which files of a step a file list answers. */
export type StepFileSet = "direct" | "feature" | "reachable" | "type-only";

/** The most files one page of a step file list holds. */
export const STEP_FILES_PAGE_LIMIT = 200;

/**
 * `GET /flows/:feature/:flow/steps/:index/files?set=<set>&offset=<n>&limit=<n>`:
 * one page of a step's files (sorted by module, then path) with the module
 * counts of the whole set. `limit` defaults to and is capped at
 * {@link STEP_FILES_PAGE_LIMIT}.
 */
export type GrimoireStepFilesAnswer = {
  ref: FlowRef;
  index: number;
  set: StepFileSet;
  total: number;
  offset: number;
  limit: number;
  files: { file: string; module: string; owner: string | null }[];
  /** Every module of the set with its file count, largest first. */
  modules: { module: string; count: number }[];
};

// ── Check ──────────────────────────────────────────────────────────────────

/** Filters of `GET /check` (query parameters of the same names). No filter answers the whole report. */
export type GrimoireCheckFilter = {
  code?: string;
  feature?: string;
  /** `<feature>/<flow>`. */
  flow?: string;
  severity?: "error" | "warning";
  /** `expected` (proposed work) or `unexpected`. */
  state?: "expected" | "unexpected";
  offset?: number;
  /** 1–500. */
  limit?: number;
};

/** `GET /check` with a filter: the matching findings, paged. */
export type GrimoireCheckPage = Omit<GrimoireCheckReport, "findings"> & {
  findings: GrimoireFinding[];
  /** Findings matching the filter (before paging). */
  total: number;
  offset: number;
  limit: number;
};

/** One code of the check, counted. */
export type GrimoireCheckGroup = {
  code: string;
  severity: "error" | "warning";
  area: string;
  title: string;
  fix: string;
  /** Unexpected findings of the code. */
  count: number;
  /** Expected findings of the code (proposed work). */
  expected: number;
  /** Features with findings of this code, largest first; `(none)` for findings with no feature. */
  features: { feature: string; count: number }[];
};

/**
 * `GET /check/groups`: the check by code. Sorted by severity (errors first),
 * then by `count`, largest first. The Overview's "Top problems" reads it.
 */
export type GrimoireCheckGroups = {
  counts: GrimoireCheckReport["counts"];
  ok: boolean;
  groups: GrimoireCheckGroup[];
};

// ── Product map ────────────────────────────────────────────────────────────

/** A traffic light for non-technical readers. */
export type ProductHealthLevel = "good" | "attention" | "problem" | "unknown";

/** Health in plain words, from test results, check errors and captured errors. */
export type ProductHealth = {
  level: ProductHealthLevel;
  /** One short sentence: "All 12 checks pass", "2 of 9 checks fail", "No checks yet". */
  reason: string;
  criteria: { total: number; pass: number; fail: number; stale: number; notRun: number; noTest: number };
  /** Captured errors of the last hour on routes this feature or flow uses; `null` when the monitor reports none (no source). */
  errors: { count: number; lastSeen: number | null } | null;
};

/** An image shown on the product map. `src` is relative to the panel's files URL. */
export type ProductScreenshot = { src: string; alt: string };

/** One feature card of the map. */
export type ProductFeatureCard = {
  id: string;
  title: string;
  summary: string | null;
  /** README `audience`, else the distinct `who` of its flows. */
  audience: string[];
  apps: string[];
  status: WrittenStatus;
  version: FeatureVersion;
  flows: number;
  health: ProductHealth;
};

/** `GET /product`: the feature map. */
export type ProductMapAnswer = {
  /** When the book was built (ISO). */
  builtAt: string;
  features: ProductFeatureCard[];
  apps: { id: string; type: "site" | "mobile"; title: string | null }[];
  /** Whether the answers carry developer detail (never through a share link). */
  developer: boolean;
};

/** One flow as a short story on the feature page. */
export type ProductFlowCard = {
  id: string;
  ref: FlowRef;
  title: string;
  summary: string | null;
  who: string;
  status: WrittenStatus;
  health: ProductHealth;
};

/** Where a reader sees a feature or flow in an app. */
export type ProductAppearance = {
  app: string;
  type: "page" | "screen" | "layout";
  /** Page or screen folder, or layout id. */
  id: string;
  title: string | null;
  route: string | null;
  block: string;
  flow: FlowRef | null;
  screenshots: ProductScreenshot[];
};

/** One feature version in plain words. */
export type ProductRelease = {
  version: FeatureVersion;
  /** The project release that shipped it, or `null` while unreleased. */
  release: string | null;
  date: string | null;
  changes: { word: ChangeWord; flow: string | null; text: string }[];
};

/** Open work on a feature. */
export type ProductPlannedItem = {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  flow: string | null;
};

/** What only the signed-in view carries ("For developers"). */
export type ProductDeveloperDetail = {
  folders: string[];
  routes: BookRouteRef[];
  /** Own files count and the check findings count of the feature. */
  files: number;
  findings: GrimoireCheckReport["counts"];
};

/** `GET /product/features/:feature`. */
export type ProductFeatureAnswer = {
  feature: {
    id: string;
    title: string;
    summary: string | null;
    why: string | null;
    audience: string[];
    apps: string[];
    status: WrittenStatus;
    version: FeatureVersion;
    updated: string;
    origin: WrittenOrigin | null;
  };
  flows: ProductFlowCard[];
  appearances: ProductAppearance[];
  releases: ProductRelease[];
  planned: ProductPlannedItem[];
  health: ProductHealth;
  /** `null` through a share link. */
  developer: ProductDeveloperDetail | null;
};

/** One step of a flow in the user's words (`## Story`), or derived from a technical step when no story is written. */
export type ProductStoryStep = {
  index: number;
  text: string;
  screenshots: ProductScreenshot[];
  /** `true` when the text was derived from a technical step (no `## Story` written). */
  derived: boolean;
};

/** One criterion in plain words. */
export type ProductProof = {
  id: CriterionId;
  text: string;
  status: CriterionStatus;
  /** Signed-in view only: the proving tests. `null` through a share link. */
  tests: FlowBookmapCriterion["tests"] | null;
};

/** `GET /product/flows/:feature/:flow`. */
export type ProductFlowAnswer = {
  flow: {
    ref: FlowRef;
    feature: string;
    featureTitle: string;
    title: string;
    summary: string | null;
    who: string;
    status: WrittenStatus;
    since: FeatureVersion;
  };
  story: ProductStoryStep[];
  proof: ProductProof[];
  /** Edge cases the flow handles, and the ones that do not apply, in plain words. */
  cases: { question: string; answer: string; handled: boolean; criteria: CriterionId[] }[];
  appearances: ProductAppearance[];
  previous: GrimoireFlowNeighbour | null;
  next: GrimoireFlowNeighbour | null;
  health: ProductHealth;
  /** Signed-in view only: technical steps with counts. `null` through a share link. */
  developer: { steps: GrimoireFlowStep[] } | null;
};
