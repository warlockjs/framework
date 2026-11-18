/**
 * Ownership, book maps and the collected indexes: the files Warlock writes
 * next to the agent's files under `grimoire/features/` and `grimoire/tasks/`.
 * All are ignored by git and carry no timestamps.
 */
import type { BookRouteRef, BOOK_SCHEMA_VERSION } from "./book";
import type { CriterionStatus, TestOutcome } from "./test-results";
import type {
  CriterionId,
  FeatureVersion,
  FlowRef,
  StepType,
  TaskStatus,
  TaskType,
  WrittenOrigin,
  WrittenStatus,
} from "./written";

// ── Ownership ──────────────────────────────────────────────────────────────

/**
 * Who owns one source file.
 *
 * Rules: a `@feature <id>` header tag wins; then a `folders` entry that names
 * the file itself; otherwise the feature whose `folders` entry is the deepest
 * folder holding the file. Two different tags, or the same file or folder
 * listed by two features, is a conflict (`GR3003`) and the
 * file gets no owner. A feature borrows a file it does not own when one of its
 * own files imports it.
 */
export type FileOwnership = {
  file: string;
  owner: string | null;
  /** How the owner was decided. */
  via: "tag" | "folder" | "file" | null;
  /** The `folders` entry that matched, when `via` is `folder`. */
  folder: string | null;
  /** Every feature that claimed the file when there was a conflict. Empty otherwise. */
  conflicts: { feature: string; via: "tag" | "folder" | "file" }[];
  /** Features with an own file that imports this one, sorted. */
  borrowedBy: string[];
};

/** Ownership of every code file in the book. */
export type Ownership = {
  files: Record<string, FileOwnership>;
  /** Feature id → its own and borrowed files, sorted. */
  features: Record<string, { own: string[]; borrowed: string[] }>;
};

// ── Book maps ──────────────────────────────────────────────────────────────

/** `grimoire/features/<feature>/bookmap.json`. */
export type FeatureBookmap = {
  schemaVersion: typeof BOOK_SCHEMA_VERSION;
  feature: string;
  /** Files the feature owns. */
  own: string[];
  /** Files of other features (or of no feature) that its own files import directly. */
  borrowed: { file: string; owner: string | null; by: string[] }[];
  /** Routes whose handler file or routes file the feature owns. */
  routes: (BookRouteRef & { file: string })[];
  /** App id → pages and screens whose page, setup or screen file the feature owns. */
  pages: Record<string, { route: string; file: string; type: "page" | "screen" }[]>;
  /** Own files that no step of any of its flows reaches. */
  unreached: string[];
};

/** One step of a flow with the files behind it. */
export type FlowBookmapStep = {
  index: number;
  type: StepType;
  target: string;
  /**
   * `true` when the step's name matched the book; `false` when it did not;
   * `null` for kinds the book cannot check (`outside service`) and for
   * route steps when no route facts exist.
   */
  found: boolean | null;
  /** The file the step starts from (handler, page, mail file…), or `null`. */
  entry: string | null;
  /**
   * Every file the step starts from, sorted: a page and its setup file, each
   * matching route's handler file and routes file, each named file. Empty
   * when nothing matched.
   */
  entries: string[];
  /** Project files the entries import directly (any import, type-only included), minus the entries, sorted. */
  direct: string[];
  /**
   * The entries and every project file they reach through imports that run
   * (type-only imports are not followed), sorted.
   */
  files: string[];
  /**
   * Files reached only through type-only imports (not in `files`), sorted.
   * `files` plus these is the step's full reach: ownership coverage
   * (`unreached`, `GR3006`), the book entries' `flows` and `scry --impact`
   * count both.
   */
  typeOnlyFiles: string[];
};

/** One acceptance criterion with its tests and their last results. */
export type FlowBookmapCriterion = {
  id: CriterionId;
  app: string | null;
  text: string;
  tests: {
    file: string;
    line: number;
    name: string | null;
    /** `not-run` when the results store has no result for it. */
    result: TestOutcome | "not-run";
    stale: boolean;
  }[];
  status: CriterionStatus;
};

/** `grimoire/features/<feature>/flows/<flow>.bookmap.json`. */
export type FlowBookmap = {
  schemaVersion: typeof BOOK_SCHEMA_VERSION;
  feature: string;
  flow: string;
  ref: FlowRef;
  steps: FlowBookmapStep[];
  criteria: FlowBookmapCriterion[];
  /** Pages, screens and layouts whose blocks show the flow. */
  shownBy: {
    app: string;
    type: "page" | "screen" | "layout";
    /** Page/screen folder or layout id. */
    id: string;
    block: string;
    /** The written file holding the row. */
    file: string;
  }[];
};

// ── Collected indexes ──────────────────────────────────────────────────────

/** `grimoire/features/index.json`. */
export type FeaturesIndex = {
  schemaVersion: typeof BOOK_SCHEMA_VERSION;
  features: {
    id: string;
    title: string;
    status: WrittenStatus;
    version: FeatureVersion;
    /** README `updated`. */
    updated: string;
    apps: string[];
    origin: WrittenOrigin | null;
    flows: { id: string; status: WrittenStatus; since: FeatureVersion }[];
    /** Released versions from the changelog, newest first (dates come from the changelog). */
    releases: { version: FeatureVersion; release: string; date: string }[];
  }[];
};

/** One task as the index lists it. */
export type TaskSummary = {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  feature: string | null;
  flow: string | null;
  apps: string[];
  file: string;
  shipped: { feature: string; version: FeatureVersion } | null;
  decisionNeeded: string | null;
};

/**
 * `grimoire/tasks/index.json`. `waiting` holds the open tasks that wait for
 * the owner: status `waiting for approval`, or a `Decision needed` line.
 * Tasks are sorted by id number.
 */
export type TasksIndex = {
  schemaVersion: typeof BOOK_SCHEMA_VERSION;
  open: TaskSummary[];
  waiting: TaskSummary[];
  done: TaskSummary[];
};

/** Every collected file `openGrimoire()` writes, in memory. */
export type CollectedFiles = {
  features: Record<string, FeatureBookmap>;
  /** By `<feature>/<flow>`. */
  flows: Record<string, FlowBookmap>;
  featuresIndex: FeaturesIndex;
  tasksIndex: TasksIndex;
};
