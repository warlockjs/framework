/**
 * `scry`: the questions agents and people ask the Grimoire. The CLI
 * (`warlock scry`), the MCP tools and the devtools tab all call `scry()` with
 * one of these queries and print or render the result.
 */
import type { BookPage, BookRoute } from "./adapter";
import type { BookEntry } from "./book";
import type { FeatureBookmap, FlowBookmap, TaskSummary } from "./bookmap";
import type { GrimoireFinding, RouteFreshness } from "./findings";
import type { WrittenChangelogEntry, WrittenFeatureReadme, WrittenFlow } from "./written";

export type ScryQuery =
  /** `warlock scry <file>` */
  | { type: "file"; file: string }
  /** `warlock scry --impact <file>` */
  | { type: "impact"; file: string }
  /** `warlock scry --route "<METHOD path>"` */
  | { type: "route"; method: string; path: string; site?: string }
  /** `warlock scry --feature <id>` */
  | { type: "feature"; feature: string }
  /** `warlock scry --flow <feature>/<flow>` */
  | { type: "flow"; feature: string; flow: string }
  /** `warlock scry --search "<text>"`; `limit` defaults to 20; `app` keeps the hits of one app. */
  | { type: "search"; text: string; limit?: number; app?: string };

/** Notes every result may carry (stale routes, a book rebuilt on the way). */
export type ScryNotes = {
  routes: RouteFreshness;
  notes: string[];
};

/** A page or screen an answer points at. */
export type ScryPageRef = { app: string; route: string; file: string; type: "page" | "screen" };

export type ScryFileResult = ScryNotes & {
  type: "file";
  entry: BookEntry;
  /** Where the book keeps the entry (`grimoire/book/….json`), or `null` when the file has none. */
  bookEntry: string | null;
};

// `routes` below lists the affected routes, so the route freshness is only in `notes`.
export type ScryImpactResult = Omit<ScryNotes, "routes"> & {
  type: "impact";
  file: string;
  /** Files that import it, transitively, sorted; `direct` are the ones importing it directly. */
  importers: { direct: string[]; all: string[] };
  /**
   * API routes (`isPage: false`) whose handler file reaches the file through
   * imports; the routes file counts only when the handler file is unknown.
   */
  routes: Pick<BookRoute, "method" | "path" | "name" | "handlerFile">[];
  pages: ScryPageRef[];
  /** `<feature>/<flow>` whose step files include it. */
  flows: string[];
  /** Owner first, then borrowers: features whose files (not specs) import it, directly or through other files. */
  features: { id: string; via: "owner" | "borrower" }[];
  /** Test files among the importers, plus tests proving the flows above. */
  tests: string[];
};

export type ScryRouteResult = ScryNotes & {
  type: "route";
  /** The API route, or `null` when the path is a page or screen only (GET and HEAD). */
  route: BookRoute | null;
  /** The handler file and everything it imports, transitively, sorted (for a page: its file, setup file and layouts). */
  files: string[];
  /** Flow steps that name the route. */
  steps: { flow: string; index: number }[];
  /** Page whose route matches, for a page route. */
  page: BookPage | null;
  /** Every page or screen that serves the path (one per site), each with its own files; empty for an API route. */
  pages: ScryRoutePage[];
};

/** A page or screen found by its URL, with the import closure of its file, setup file and layouts. */
export type ScryRoutePage = ScryPageRef & {
  /** Site id of a page, or the mobile app id of a screen. */
  site: string;
  setupFile: string | null;
  layouts: string[];
  files: string[];
};

/** What a failed scry prints under `--json` and returns from the MCP tools. */
export type ScryError = {
  type: "error";
  /** The `GRnnnn` code. */
  code: string;
  message: string;
  /** What to do next, or an empty string when the code has no fix text. */
  fix: string;
};

/** One flow of a feature answer, with the counts the flow cards show. */
export type ScryFeatureFlow = {
  id: string;
  status: string;
  since: string;
  heading: string | null;
  /** Technical steps written in the flow file. */
  steps: number;
  /** Edge cases written in the flow (`## Cases`). */
  cases: number;
  /** Acceptance criteria written in the flow. */
  criteria: number;
  /** Criteria with at least one `@proves` test. */
  tested: number;
  /** Findings about the flow that are not expected (a `proposed` flow's findings are). */
  findings: number;
};

export type ScryFeatureResult = ScryNotes & {
  type: "feature";
  readme: WrittenFeatureReadme;
  flows: ScryFeatureFlow[];
  bookmap: FeatureBookmap;
  /** Newest first, at most 10. */
  changes: WrittenChangelogEntry[];
  /** Open tasks naming the feature. */
  tasks: TaskSummary[];
  findings: GrimoireFinding[];
};

export type ScryFlowResult = ScryNotes & {
  type: "flow";
  flow: WrittenFlow;
  bookmap: FlowBookmap;
  /** Changelog entries naming the flow, newest first. */
  history: WrittenChangelogEntry[];
  findings: GrimoireFinding[];
};

/** What a search hit is. */
export type ScryHitType =
  | "feature"
  | "flow"
  | "block"
  | "page"
  | "screen"
  | "route"
  | "mail"
  | "job"
  | "file"
  | "export"
  | "task";

/** One search hit, ranked. */
export type ScryHit = {
  type: ScryHitType;
  /**
   * The id to ask about next: a feature id, `<feature>/<flow>`,
   * `<app>/<page>/<block>`, `<app> <route>`, `METHOD path`, a file path,
   * `<file>#<export>`, a mail or job name, or a task id.
   */
  id: string;
  /** Short text shown after the id (a header sentence, a block's flow). */
  detail: string | null;
  /** The app of a page, screen, block or file hit; absent for the rest. */
  app?: string;
  /** Higher is better. Only the order is meaningful: name matches score above every written-text match. */
  score: number;
  /**
   * For a feature or flow found by its written text: the part that matched
   * (`AC-5: …`, `case duplicate: …`, `story 2: …`, `summary: …`). Absent when the name matched.
   */
  matched?: string;
};

export type ScrySearchResult = ScryNotes & {
  type: "search";
  text: string;
  /** How many candidates matched, per type, before the limit cut the list. */
  counts: Partial<Record<ScryHitType, number>>;
  /** Best first, whatever the type; on an equal score features and flows come first. */
  hits: ScryHit[];
};

export type ScryResult =
  | ScryFileResult
  | ScryImpactResult
  | ScryRouteResult
  | ScryFeatureResult
  | ScryFlowResult
  | ScrySearchResult;
