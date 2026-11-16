/**
 * The files behind each step of a flow: what a route, page, mail, job, event
 * or notification step reaches in the book.
 */
import type { BookFacts, BookNamedType } from "../contracts/adapter";
import type { FlowBookmapStep } from "../contracts/bookmap";
import type { AppMatch } from "../contracts/snapshot";
import type { WrittenFeature, WrittenGrimoire, WrittenStep } from "../contracts/written";
import { importClosure, type FileGraph } from "../graph";

const NAMED_TYPES: ReadonlySet<string> = new Set<BookNamedType>([
  "mail",
  "job",
  "event",
  "notification",
]);

/** A route path with params written one way (`:id` and `[id]` → `:id`) and no trailing `/`. */
export function normalizeRoutePath(route: string): string {
  const withParams = route
    .trim()
    .replace(/\[\.\.\.([^\]]+)\]/g, ":$1")
    .replace(/\[([^\]]+)\]/g, ":$1");
  const trimmed = withParams.replace(/\/+$/, "");

  return trimmed === "" ? "/" : trimmed;
}

/**
 * Whether a route answers `METHOD path`: paths compared after
 * `normalizeRoutePath` (`:id` ≡ `[id]`, trailing `/` ignored), methods
 * without regard to case, `ALL` on either side matching any method. The
 * check, the book maps and `scry --route` all match this way.
 */
export function routeMatches(
  route: { readonly method: string; readonly path: string },
  method: string,
  path: string,
): boolean {
  const routeMethod = route.method.toUpperCase();
  const asked = method.toUpperCase();
  const methodMatches = routeMethod === asked || routeMethod === "ALL" || asked === "ALL";

  return methodMatches && normalizeRoutePath(route.path) === normalizeRoutePath(path);
}

function sortedUnique(files: Iterable<string>): string[] {
  return [...new Set(files)].sort();
}

/** What the step matched: its entry file and the files behind it. */
type StepMatch = Pick<FlowBookmapStep, "found" | "entry" | "files">;

const NOTHING: StepMatch = { found: false, entry: null, files: [] };

function routeStep(step: WrittenStep, facts: BookFacts, graph: FileGraph): StepMatch {
  if (facts.routes === null || step.route === null) return { found: null, entry: null, files: [] };

  const target = step.route;
  const routes = facts.routes.filter((route) => routeMatches(route, target.method, target.path));
  const first = routes[0];

  if (!first) return NOTHING;

  const files = new Set<string>();

  for (const route of routes) {
    if (route.handlerFile !== null)
      importClosure(graph, [route.handlerFile]).forEach((file) => files.add(file));
    if (route.sourceFile !== null) files.add(route.sourceFile);
  }

  return { found: true, entry: first.handlerFile ?? first.sourceFile, files: sortedUnique(files) };
}

function pageStep(
  step: WrittenStep,
  feature: WrittenFeature,
  facts: BookFacts,
  apps: Record<string, AppMatch>,
  graph: FileGraph,
): StepMatch {
  const wanted = normalizeRoutePath(step.target);
  const entries: string[] = [];
  const files = new Set<string>();

  // `page /support [web-admin]` looks in that app only; without a scope, in the feature's apps.
  const appIds =
    step.app === null ? (feature.readme?.apps.map((app) => app.value) ?? []) : [step.app];

  for (const appId of appIds) {
    const match = apps[appId];

    if (!match) continue;

    if (match.site) {
      const siteId = match.site.id;

      for (const page of facts.pages) {
        if (page.site !== siteId || normalizeRoutePath(page.route) !== wanted) continue;

        entries.push(page.file);
        const start = page.setupFile === null ? [page.file] : [page.file, page.setupFile];
        importClosure(graph, start).forEach((file) => files.add(file));
        start.forEach((file) => files.add(file));
      }
    }

    if (match.mobile) {
      for (const screen of match.mobile.screens) {
        if (normalizeRoutePath(screen.route) !== wanted) continue;

        entries.push(screen.file);
        importClosure(graph, [screen.file]).forEach((file) => files.add(file));
        files.add(screen.file);
      }
    }
  }

  const entry = entries[0];

  if (entry === undefined) return NOTHING;

  return { found: true, entry, files: sortedUnique(files) };
}

function namedStep(step: WrittenStep, facts: BookFacts, graph: FileGraph): StepMatch {
  const named = facts.named.filter(
    (thing) => thing.type === step.type && thing.name === step.target,
  );
  const first = named[0];

  if (!first) return NOTHING;

  const files = new Set<string>();

  for (const thing of named) {
    if (thing.file === null) continue;

    importClosure(graph, [thing.file]).forEach((file) => files.add(file));
    files.add(thing.file);
  }

  return { found: true, entry: first.file, files: sortedUnique(files) };
}

function affectsStep(step: WrittenStep, written: WrittenGrimoire): StepMatch {
  const target = step.affects;

  if (target === null) return NOTHING;

  const feature = written.features.find((candidate) => candidate.id === target.feature);
  const found =
    feature !== undefined &&
    (target.flow === null || feature.flows.some((flow) => flow.id.value === target.flow));

  return { found, entry: null, files: [] };
}

/** Everything the step resolver reads. */
export type StepContext = {
  written: WrittenGrimoire;
  facts: BookFacts;
  apps: Record<string, AppMatch>;
  graph: FileGraph;
};

/** One step of a flow of `feature`, with what it matched in the book. */
export function resolveStep(
  step: WrittenStep,
  feature: WrittenFeature,
  context: StepContext,
): FlowBookmapStep {
  let match: StepMatch;

  if (step.type === "route") match = routeStep(step, context.facts, context.graph);
  else if (step.type === "page")
    match = pageStep(step, feature, context.facts, context.apps, context.graph);
  else if (NAMED_TYPES.has(step.type)) match = namedStep(step, context.facts, context.graph);
  else if (step.type === "affects") match = affectsStep(step, context.written);
  else match = { found: null, entry: null, files: [] };

  const target = step.app === null ? step.target : `${step.target} [${step.app}]`;

  return { index: step.index, type: step.type, target, ...match };
}
