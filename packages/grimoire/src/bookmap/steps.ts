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

/** What the step matched: its entry files and the files behind them. */
type StepMatch = Pick<
  FlowBookmapStep,
  "found" | "entry" | "entries" | "direct" | "files" | "typeOnlyFiles"
>;

const NOTHING: StepMatch = {
  found: false,
  entry: null,
  entries: [],
  direct: [],
  files: [],
  typeOnlyFiles: [],
};

const UNKNOWN: StepMatch = { ...NOTHING, found: null };

/**
 * Work out a step's files from its entry files. `extra` are files that belong
 * to the step without being imported by an entry (a route's routes file).
 */
function reach(
  graph: FileGraph,
  entries: readonly string[],
  extra: readonly string[] = [],
): Pick<StepMatch, "entries" | "direct" | "files" | "typeOnlyFiles"> {
  const entryFiles = sortedUnique(entries);
  const known = new Set(entryFiles);
  const direct = new Set<string>();

  for (const entry of entryFiles) {
    for (const edge of graph.get(entry)?.imports ?? []) {
      if (edge.file !== null && !known.has(edge.file)) direct.add(edge.file);
    }
  }

  const files = new Set([
    ...entryFiles,
    ...extra,
    ...importClosure(graph, entryFiles, { skipTypeOnly: true }),
  ]);
  const everything = importClosure(graph, entryFiles);

  return {
    entries: entryFiles,
    direct: sortedUnique(direct),
    files: sortedUnique(files),
    typeOnlyFiles: everything.filter((file) => !files.has(file)),
  };
}

/** `auth-only.middleware.ts` → `authOnly` (the camelCase stem without the role suffix). */
function middlewareNameOf(file: string): string {
  const base = (file.split("/").pop() ?? file).replace(/\.(?:d\.ts|[cm]?[jt]sx?)$/, "");
  const stem = base.replace(/\.middleware$/, "");

  return stem.replace(/[-_.]+([a-zA-Z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

/**
 * The files of the middleware a route names. A name matches a file that exports
 * it, or a `*.middleware.*` file whose stem is the name (`auth-only.middleware.ts` ↔ `authOnly`).
 * When the routes file imports some of the matches, only those count (two
 * modules may name a middleware the same). The routes file's other imports are
 * not followed: it imports every controller of its module.
 */
function middlewareFiles(
  names: readonly string[],
  routesFile: string | null,
  graph: FileGraph,
): string[] {
  const imported = new Set(
    routesFile === null
      ? []
      : (graph.get(routesFile)?.imports ?? []).flatMap((edge) =>
          edge.file === null ? [] : [edge.file],
        ),
  );
  const found: string[] = [];

  for (const name of names) {
    const matches: string[] = [];

    for (const [file, entry] of graph) {
      const exports = (entry as { exports?: readonly { name: string }[] }).exports ?? [];

      const byStem =
        /\.middleware\.(?:[cm]?[jt]sx?)$/.test(file) && middlewareNameOf(file) === name;

      if (exports.some((item) => item.name === name) || byStem) matches.push(file);
    }

    const near = matches.filter((file) => imported.has(file));

    found.push(...(near.length > 0 ? near : matches.length === 1 ? matches : []));
  }

  return found;
}

function routeStep(step: WrittenStep, facts: BookFacts, graph: FileGraph): StepMatch {
  if (facts.routes === null || step.route === null) return UNKNOWN;

  const target = step.route;
  const routes = facts.routes.filter((route) => routeMatches(route, target.method, target.path));
  const first = routes[0];

  if (!first) return NOTHING;

  const handlers = routes.flatMap((route) =>
    route.handlerFile === null ? [] : [route.handlerFile],
  );
  const sources = routes.flatMap((route) => (route.sourceFile === null ? [] : [route.sourceFile]));
  const middleware = routes.flatMap((route) =>
    middlewareFiles(route.middleware, route.sourceFile, graph),
  );
  const handlerReach = reach(graph, [...handlers, ...middleware], sources);
  // The routes files are entries too, but their own imports are not part of the step.
  const entries = sortedUnique([...handlers, ...middleware, ...sources]);

  return {
    found: true,
    entry: first.handlerFile ?? first.sourceFile,
    ...handlerReach,
    entries,
    direct: handlerReach.direct.filter((file) => !entries.includes(file)),
  };
}

function pageStep(
  step: WrittenStep,
  feature: WrittenFeature,
  facts: BookFacts,
  apps: Record<string, AppMatch>,
  graph: FileGraph,
): StepMatch {
  const wanted = normalizeRoutePath(step.target);
  const matched: string[] = [];
  const starts: string[] = [];

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

        matched.push(page.file);
        starts.push(page.file);
        if (page.setupFile !== null) starts.push(page.setupFile);
      }
    }

    if (match.mobile) {
      for (const screen of match.mobile.screens) {
        if (normalizeRoutePath(screen.route) !== wanted) continue;

        matched.push(screen.file);
        starts.push(screen.file);
      }
    }
  }

  const entry = matched[0];

  if (entry === undefined) return NOTHING;

  return { found: true, entry, ...reach(graph, starts) };
}

function namedStep(step: WrittenStep, facts: BookFacts, graph: FileGraph): StepMatch {
  const named = facts.named.filter(
    (thing) => thing.type === step.type && thing.name === step.target,
  );
  const first = named[0];

  // Mails, jobs, events and notifications come from the booted app: without route facts they were not checked.
  if (!first) return facts.routes === null ? UNKNOWN : NOTHING;

  const entries = named.flatMap((thing) => (thing.file === null ? [] : [thing.file]));

  return { found: true, entry: first.file, ...reach(graph, entries) };
}

function affectsStep(step: WrittenStep, written: WrittenGrimoire): StepMatch {
  const target = step.affects;

  if (target === null) return NOTHING;

  const feature = written.features.find((candidate) => candidate.id === target.feature);
  const found =
    feature !== undefined &&
    (target.flow === null || feature.flows.some((flow) => flow.id.value === target.flow));

  return { ...NOTHING, found };
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
  else match = UNKNOWN;

  const target = step.app === null ? step.target : `${step.target} [${step.app}]`;

  return { index: step.index, type: step.type, target, ...match };
}
