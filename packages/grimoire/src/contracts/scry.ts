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
  | { type: "route"; method: string; path: string }
  /** `warlock scry --feature <id>` */
  | { type: "feature"; feature: string }
  /** `warlock scry --flow <feature>/<flow>` */
  | { type: "flow"; feature: string; flow: string }
  /** `warlock scry --search "<text>"`; `limit` defaults to 20. */
  | { type: "search"; text: string; limit?: number };

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
};

// `routes` below lists the affected routes, so the route freshness is only in `notes`.
export type ScryImpactResult = Omit<ScryNotes, "routes"> & {
  type: "impact";
  file: string;
  /** Files that import it, transitively, sorted; `direct` are the ones importing it directly. */
  importers: { direct: string[]; all: string[] };
  /** Routes whose handler or routes file reaches the file through imports. */
  routes: Pick<BookRoute, "method" | "path" | "name" | "handlerFile">[];
  pages: ScryPageRef[];
  /** `<feature>/<flow>` whose step files include it. */
  flows: string[];
  /** Owner first, then borrowers. */
  features: { id: string; via: "owner" | "borrower" }[];
  /** Test files among the importers, plus tests proving the flows above. */
  tests: string[];
};

export type ScryRouteResult = ScryNotes & {
  type: "route";
  route: BookRoute;
  /** The handler file and everything it imports, transitively, sorted. */
  files: string[];
  /** Flow steps that name the route. */
  steps: { flow: string; index: number }[];
  /** Page whose route matches, for a page route. */
  page: BookPage | null;
};

export type ScryFeatureResult = ScryNotes & {
  type: "feature";
  readme: WrittenFeatureReadme;
  flows: { id: string; status: string; since: string; heading: string | null }[];
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
  | "file"
  | "export"
  | "task";

/** One search hit, ranked. */
export type ScryHit = {
  type: ScryHitType;
  /**
   * The id to ask about next: a feature id, `<feature>/<flow>`,
   * `<app>/<page>/<block>`, `<app> <route>`, `METHOD path`, a file path,
   * `<file>#<export>`, or a task id.
   */
  id: string;
  /** Short text shown after the id (a header sentence, a block's flow). */
  detail: string | null;
  /** Higher is better. Only the order is meaningful. */
  score: number;
};

export type ScrySearchResult = ScryNotes & {
  type: "search";
  text: string;
  hits: ScryHit[];
};

export type ScryResult =
  | ScryFileResult
  | ScryImpactResult
  | ScryRouteResult
  | ScryFeatureResult
  | ScryFlowResult
  | ScrySearchResult;
