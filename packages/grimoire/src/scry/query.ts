/**
 * Answers one scry query from a snapshot. Pure: reads the snapshot only.
 */
import { packagesOf } from "../book";
import { normalizeRoutePath, routeMatches } from "../bookmap";
import { checkGrimoire } from "../check";
import { GrimoireError } from "../codes";
import type { BookFile, BookRoute } from "../contracts/adapter";
import { BOOK_SCHEMA_VERSION, type BookEntry } from "../contracts/book";
import type { FeatureBookmap, FlowBookmap } from "../contracts/bookmap";
import type { GrimoireFinding } from "../contracts/findings";
import type {
  ScryFeatureResult,
  ScryFileResult,
  ScryFlowResult,
  ScryHit,
  ScryHitType,
  ScryImpactResult,
  ScryNotes,
  ScryPageRef,
  ScryQuery,
  ScryResult,
  ScryRouteResult,
  ScrySearchResult,
} from "../contracts/scry";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type { WrittenFeature, WrittenFlow } from "../contracts/written";
import { fileGraph, importClosure, importerClosure } from "../graph";
import { bookEntryPaths, projectPath, toPosixPath } from "../paths";

const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const sortedUnique = (items: Iterable<string>): string[] => [...new Set(items)].sort(byText);

/** Route facts with routes but none that names its source file: only the core list was read, not the app's routes files. */
const INCOMPLETE_ROUTES = "route facts look incomplete; run warlock grimoire build";

function routeFactsIncomplete(facts: GrimoireSnapshot["book"]["facts"]): boolean {
  return (
    facts.routes !== null &&
    facts.routes.length > 0 &&
    facts.routes.every((route) => route.sourceFile === null)
  );
}

/** Notes every answer carries: whether the stored book is behind the files, and how fresh the route facts are. */
function notesOf(snapshot: GrimoireSnapshot, needsRoutes: boolean): ScryNotes {
  const notes: string[] = [];

  if (snapshot.behind !== undefined) {
    const count = snapshot.behind.changed;

    notes.push(
      `book is stale (${count} ${count === 1 ? "file" : "files"} changed); run warlock grimoire build`,
    );
  }

  if (snapshot.routes === "stale") notes.push("route facts are stale; run warlock grimoire build");
  if (snapshot.routes === "missing" && needsRoutes) {
    notes.push("route facts were never read; run warlock grimoire build");
  }

  if (snapshot.book.routeNote !== undefined) notes.push(snapshot.book.routeNote);
  if (needsRoutes && routeFactsIncomplete(snapshot.book.facts)) notes.push(INCOMPLETE_ROUTES);

  return { routes: snapshot.routes, notes };
}

/** A project-relative POSIX path for what the caller typed (either separator, absolute or relative). */
function fileOf(snapshot: GrimoireSnapshot, file: string): string {
  return projectPath(snapshot.root, toPosixPath(file.trim()));
}

function bookFile(snapshot: GrimoireSnapshot, file: string): BookFile {
  const found = snapshot.book.facts.files.find((item) => item.file === file);

  if (!found) {
    const roots = [
      ...new Set(snapshot.book.facts.files.map((item) => item.file.split("/")[0] ?? "")),
    ]
      .filter((root) => root !== "")
      .sort(byText);

    throw new GrimoireError(
      "GR9001",
      `${file} is not in the book. Pass a code file under ${roots.join(", ") || "the source roots"} as a project-relative path; if the file is new, run warlock grimoire build.`,
    );
  }

  return found;
}

/** The written app id that shows a site, or the site id when no written app matches it. */
function siteApp(snapshot: GrimoireSnapshot, site: string): string {
  const match = Object.values(snapshot.apps).find((app) => app.site?.id === site);

  return match?.app ?? site;
}

/** The written app id of a mobile app, or its own id. */
function mobileApp(snapshot: GrimoireSnapshot, mobile: string): string {
  const match = Object.values(snapshot.apps).find((app) => app.mobile?.id === mobile);

  return match?.app ?? mobile;
}

/** The project files a file imports only through type-only imports, sorted. */
function typeOnlyImportsOf(file: BookFile): string[] {
  const value = new Set<string>();
  const typeOnly = new Set<string>();

  for (const entry of file.imports) {
    if (entry.file === null) continue;

    (entry.typeOnly === true ? typeOnly : value).add(entry.file);
  }

  return sortedUnique([...typeOnly].filter((target) => !value.has(target)));
}

/** The book entry of one file, as the book writes it. */
function entryOf(snapshot: GrimoireSnapshot, file: BookFile): BookEntry {
  const facts = snapshot.book.facts;
  const annotation = snapshot.annotations.files[file.file];
  const routeRef = (route: BookRoute) => ({
    method: route.method,
    path: route.path,
    name: route.name,
  });
  const routes = facts.routes ?? [];

  return {
    schemaVersion: BOOK_SCHEMA_VERSION,
    file: file.file,
    module: file.module,
    type: file.type,
    lines: file.lines,
    about: file.about,
    feature: annotation?.feature ?? null,
    borrowedBy: sortedUnique(annotation?.borrowedBy ?? []),
    flows: sortedUnique(annotation?.flows ?? []),
    exports: file.exports.map((entry) => ({ name: entry.name, about: entry.about })),
    // The same list the book entry holds (bare Node builtins such as `fs` left out too).
    packages: packagesOf(file),
    imports: sortedUnique(
      file.imports.flatMap((entry) => (entry.file === null ? [] : [entry.file])),
    ),
    // The same rule as the book entry: project files whose every import edge is type-only.
    typeOnlyImports: typeOnlyImportsOf(file),
    importedBy: sortedUnique(file.importedBy),
    routes: [
      ...routes
        .filter((route) => route.sourceFile === file.file)
        .map((route) => ({ ...routeRef(route), via: "registers" as const })),
      ...routes
        .filter((route) => route.handlerFile === file.file)
        .map((route) => ({ ...routeRef(route), via: "handles" as const })),
    ],
    pages: facts.pages
      .flatMap((page) => [
        ...(page.file === file.file
          ? [{ site: page.site, route: page.route, via: "page" as const }]
          : []),
        ...(page.setupFile === file.file
          ? [{ site: page.site, route: page.route, via: "setup" as const }]
          : []),
        ...(page.layouts.includes(file.file)
          ? [{ site: page.site, route: page.route, via: "layout" as const }]
          : []),
      ])
      .sort(
        (left, right) =>
          byText(left.site, right.site) ||
          byText(left.route, right.route) ||
          byText(left.via, right.via),
      ),
    screens: facts.mobile
      .flatMap((app) =>
        app.screens.flatMap((screen) => [
          ...(screen.file === file.file
            ? [{ app: app.id, route: screen.route, via: "screen" as const }]
            : []),
          ...(screen.layouts.includes(file.file)
            ? [{ app: app.id, route: screen.route, via: "layout" as const }]
            : []),
        ]),
      )
      .sort(
        (left, right) =>
          byText(left.app, right.app) ||
          byText(left.route, right.route) ||
          byText(left.via, right.via),
      ),
  };
}

/** Where the book keeps the entry of `file`, or `null` when it has none. */
function bookEntryOf(snapshot: GrimoireSnapshot, file: string): string | null {
  const facts = snapshot.book.facts;
  const roots = new Map(facts.mobile.map((app) => [app.id, app.root]));
  const paths = bookEntryPaths(
    facts.files.map((item) => {
      const root = item.mobileApp === null ? undefined : roots.get(item.mobileApp);

      return {
        file: item.file,
        mobileApp:
          item.mobileApp === null || root === undefined ? null : { id: item.mobileApp, root },
      };
    }),
  );
  const entry = paths.get(file);

  return entry === undefined || entry.split("/").includes("..") ? null : entry;
}

function scryFile(
  snapshot: GrimoireSnapshot,
  query: Extract<ScryQuery, { type: "file" }>,
): ScryFileResult {
  const file = bookFile(snapshot, fileOf(snapshot, query.file));

  return {
    type: "file",
    ...notesOf(snapshot, false),
    entry: entryOf(snapshot, file),
    bookEntry: bookEntryOf(snapshot, file.file),
  };
}

function flowBookmaps(snapshot: GrimoireSnapshot): FlowBookmap[] {
  return Object.values(snapshot.collected.flows).sort((left, right) => byText(left.ref, right.ref));
}

function scryImpact(
  snapshot: GrimoireSnapshot,
  query: Extract<ScryQuery, { type: "impact" }>,
): ScryImpactResult {
  const facts = snapshot.book.facts;
  const target = bookFile(snapshot, fileOf(snapshot, query.file));
  const graph = fileGraph(facts.files);
  const reach = new Set(importerClosure(graph, [target.file]));
  const importers = [...reach].filter((file) => file !== target.file).sort(byText);
  const routes = (facts.routes ?? []).filter(
    (route) =>
      !route.isPage &&
      (route.handlerFile !== null
        ? reach.has(route.handlerFile)
        : route.sourceFile !== null && reach.has(route.sourceFile)),
  );
  const pages: ScryPageRef[] = [
    ...facts.pages
      .filter(
        (page) =>
          reach.has(page.file) ||
          (page.setupFile !== null && reach.has(page.setupFile)) ||
          page.layouts.some((layout) => reach.has(layout)),
      )
      .map((page) => ({
        app: siteApp(snapshot, page.site),
        route: page.route,
        file: page.file,
        type: "page" as const,
      })),
    ...facts.mobile.flatMap((app) =>
      app.screens
        .filter(
          (screen) => reach.has(screen.file) || screen.layouts.some((layout) => reach.has(layout)),
        )
        .map((screen) => ({
          app: mobileApp(snapshot, app.id),
          route: screen.route,
          file: screen.file,
          type: "screen" as const,
        })),
    ),
  ];
  const flows = flowBookmaps(snapshot)
    .filter((bookmap) =>
      bookmap.steps.some(
        (step) => step.files.includes(target.file) || step.typeOnlyFiles.includes(target.file),
      ),
    )
    .map((bookmap) => bookmap.ref);
  const ownership = snapshot.ownership.files;
  const owner = ownership[target.file]?.owner ?? null;
  // Looked up once per importer: an app with thousands of files stays linear.
  const specFiles = new Set(
    facts.files.filter((item) => item.type === "spec").map((item) => item.file),
  );
  const borrowers = sortedUnique([
    ...(ownership[target.file]?.borrowedBy ?? []),
    ...importers.flatMap((file) => {
      const ownerOf = ownership[file]?.owner;

      return ownerOf === undefined || ownerOf === null || specFiles.has(file) ? [] : [ownerOf];
    }),
  ]).filter((feature) => feature !== owner);
  const testFiles = new Set(facts.tests);
  const flowSet = new Set(flows);
  const tests = sortedUnique([
    ...importers.filter((file) => testFiles.has(file) || specFiles.has(file)),
    ...snapshot.proofs.filter((proof) => flowSet.has(proof.ref)).map((proof) => proof.at.file),
  ]);

  return {
    type: "impact",
    ...notesOf(snapshot, true),
    file: target.file,
    importers: { direct: sortedUnique(target.importedBy), all: importers },
    routes: routes.map((route) => ({
      method: route.method,
      path: route.path,
      name: route.name,
      handlerFile: route.handlerFile,
    })),
    pages,
    flows,
    features: [
      ...(owner === null ? [] : [{ id: owner, via: "owner" as const }]),
      ...borrowers.map((id) => ({ id, via: "borrower" as const })),
    ],
    tests,
  };
}

function scryRoute(
  snapshot: GrimoireSnapshot,
  query: Extract<ScryQuery, { type: "route" }>,
): ScryRouteResult {
  const facts = snapshot.book.facts;
  const method = query.method.toUpperCase();
  const asked = `${method} ${query.path}`;

  if (facts.routes === null) {
    throw new GrimoireError(
      "GR9002",
      `No route facts yet, so ${asked} cannot be looked up. Run warlock grimoire build (it boots the app once to read the routes), then ask again.`,
    );
  }

  const route = facts.routes.find((item) => routeMatches(item, method, query.path));

  if (!route) {
    const samePath = facts.routes
      .filter((item) => normalizeRoutePath(item.path) === normalizeRoutePath(query.path))
      .map((item) => `${item.method} ${item.path}`);
    if (routeFactsIncomplete(facts)) {
      throw new GrimoireError("GR9002", `No route matches ${asked}; ${INCOMPLETE_ROUTES}.`);
    }

    const hint =
      samePath.length > 0
        ? ` Routes on that path: ${samePath.join(", ")}.`
        : " Run warlock routes to list them, or warlock grimoire build when the route is new.";

    throw new GrimoireError("GR9002", `No route matches ${asked}.${hint}`);
  }

  const graph = fileGraph(facts.files);
  const start = route.handlerFile ?? route.sourceFile;
  const files = start === null ? [] : importClosure(graph, [start]);
  const steps = snapshot.written.features.flatMap((feature) =>
    feature.flows.flatMap((flow) =>
      flow.steps
        .filter(
          (step) =>
            step.type === "route" &&
            step.route !== null &&
            routeMatches(route, step.route.method, step.route.path),
        )
        .map((step) => ({ flow: flow.ref, index: step.index })),
    ),
  );
  const page = route.isPage
    ? (facts.pages.find((item) => item.file === route.handlerFile) ??
      facts.pages.find(
        (item) => normalizeRoutePath(item.route) === normalizeRoutePath(route.path),
      ) ??
      null)
    : null;

  return {
    type: "route",
    ...notesOf(snapshot, true),
    route,
    files,
    steps: steps.sort((left, right) => byText(left.flow, right.flow) || left.index - right.index),
    page,
  };
}

function writtenFeature(snapshot: GrimoireSnapshot, id: string): WrittenFeature {
  const feature = snapshot.written.features.find((item) => item.id === id);

  if (!feature) {
    const known = snapshot.written.features.map((item) => item.id).sort(byText);
    const list =
      known.length > 0
        ? ` Features: ${known.join(", ")}.`
        : " The project has no grimoire/features/ folder yet.";

    throw new GrimoireError("GR9003", `No feature has the id ${JSON.stringify(id)}.${list}`);
  }

  return feature;
}

function findingsFor(
  snapshot: GrimoireSnapshot,
  match: (finding: GrimoireFinding) => boolean,
): GrimoireFinding[] {
  return checkGrimoire(snapshot).findings.filter(match);
}

function emptyFeatureBookmap(feature: string): FeatureBookmap {
  return {
    schemaVersion: BOOK_SCHEMA_VERSION,
    feature,
    own: [],
    borrowed: [],
    routes: [],
    pages: {},
    unreached: [],
  };
}

function scryFeature(
  snapshot: GrimoireSnapshot,
  query: Extract<ScryQuery, { type: "feature" }>,
): ScryFeatureResult {
  const feature = writtenFeature(snapshot, query.feature);

  if (feature.readme === null) {
    throw new GrimoireError(
      "GR9003",
      `grimoire/features/${feature.id} has no README.md, so the feature cannot be shown. Write the README (see warlock grimoire check), then ask again.`,
    );
  }

  const findings = findingsFor(
    snapshot,
    (finding) =>
      finding.subject.feature === feature.id ||
      (finding.subject.flow ?? "").startsWith(`${feature.id}/`),
  );

  return {
    type: "feature",
    ...notesOf(snapshot, false),
    readme: feature.readme,
    flows: [...feature.flows]
      .sort((left, right) => byText(left.id.value, right.id.value))
      .map((flow) => {
        const criteria = snapshot.collected.flows[flow.ref]?.criteria ?? [];

        return {
          id: flow.id.value,
          status: flow.status.value,
          since: flow.since.value,
          heading: flow.heading?.value ?? null,
          steps: flow.steps.length,
          cases: flow.cases.length,
          criteria: flow.criteria.length,
          tested: criteria.filter((criterion) => criterion.tests.length > 0).length,
          findings: findings.filter(
            (finding) => !finding.expected && finding.subject.flow === flow.ref,
          ).length,
        };
      }),
    bookmap: snapshot.collected.features[feature.id] ?? emptyFeatureBookmap(feature.id),
    changes: (feature.changelog?.entries ?? []).slice(0, 10),
    tasks: snapshot.collected.tasksIndex.open.filter((task) => task.feature === feature.id),
    findings,
  };
}

function scryFlow(
  snapshot: GrimoireSnapshot,
  query: Extract<ScryQuery, { type: "flow" }>,
): ScryFlowResult {
  const feature = writtenFeature(snapshot, query.feature);
  const flow: WrittenFlow | undefined = feature.flows.find((item) => item.id.value === query.flow);

  if (!flow) {
    const known = feature.flows.map((item) => item.id.value).sort(byText);
    const list =
      known.length > 0
        ? ` Flows of ${feature.id}: ${known.join(", ")}.`
        : ` ${feature.id} has no flows yet.`;

    throw new GrimoireError("GR9004", `No flow ${feature.id}/${query.flow}.${list}`);
  }

  const bookmap =
    Object.values(snapshot.collected.flows).find(
      (item) => item.feature === feature.id && item.flow === flow.id.value,
    ) ?? snapshot.collected.flows[flow.ref];

  if (!bookmap) {
    throw new GrimoireError(
      "GR9004",
      `${flow.ref} has no book map yet. Run warlock grimoire build, then ask again.`,
    );
  }

  return {
    type: "flow",
    ...notesOf(snapshot, true),
    flow,
    bookmap,
    history: (feature.changelog?.entries ?? []).filter((entry) => entry.flow === flow.id.value),
    findings: findingsFor(snapshot, (finding) => finding.subject.flow === flow.ref),
  };
}

// ── Search ─────────────────────────────────────────────────────────────────

const TYPE_ORDER: readonly ScryHitType[] = [
  "feature",
  "flow",
  "block",
  "page",
  "screen",
  "route",
  "mail",
  "job",
  "file",
  "export",
  "task",
];

/** Lower-case words: `catalog/new-arrivals.service.ts` → `catalog new arrivals service ts`. */
function words(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The last segment of an id (`catalog/new-arrivals` → `new-arrivals`). */
function lastSegment(id: string): string {
  const parts = id.split(/[\s/#]+/).filter((part) => part !== "");

  return parts[parts.length - 1] ?? id;
}

/** The slug of a block name (`New arrivals` → `new-arrivals`). */
function slug(text: string): string {
  return words(text).split(" ").join("-");
}

/** One searchable piece of written text of a feature or flow (a summary, a story, a case, a criterion). */
type BodyPart = { label: string; text: string };

type Candidate = Omit<ScryHit, "score" | "matched"> & { body?: BodyPart[] };

/** The searchable written text of a flow: summary, who, story, cases, criteria. */
function flowBody(flow: WrittenFlow): BodyPart[] {
  return [
    ...(flow.summary === null ? [] : [{ label: "summary", text: flow.summary }]),
    { label: "who", text: flow.who.value },
    ...flow.story.map((step) => ({ label: `story ${step.index}`, text: step.text })),
    ...flow.cases.map((item) => ({
      label: `case ${item.question}`,
      text: `${item.question} ${item.answer} ${item.criteria.join(" ")}`,
    })),
    ...flow.criteria.map((item) => ({ label: item.id, text: `${item.id} ${item.text}` })),
  ];
}

/** The searchable written text of a feature: summary, why, audience. */
function featureBody(feature: WrittenFeature): BodyPart[] {
  const readme = feature.readme;

  if (readme === null) return [];

  return [
    ...(readme.summary === null ? [] : [{ label: "summary", text: readme.summary }]),
    ...(readme.why === null ? [] : [{ label: "why", text: readme.why }]),
    ...readme.audience.map((item) => ({ label: "audience", text: item.value })),
  ];
}

function candidates(snapshot: GrimoireSnapshot): Candidate[] {
  const facts = snapshot.book.facts;
  const list: Candidate[] = [];

  for (const feature of snapshot.written.features) {
    list.push({
      type: "feature",
      id: feature.id,
      detail: feature.readme?.title.value ?? null,
      body: featureBody(feature),
    });

    for (const flow of feature.flows) {
      list.push({
        type: "flow",
        id: flow.ref,
        detail: flow.heading?.value ?? null,
        body: flowBody(flow),
      });
    }
  }

  for (const app of snapshot.written.apps) {
    const appId = app.id.value;

    for (const layout of app.layouts) {
      for (const row of layout.blocks) {
        list.push({
          type: "block",
          id: `${appId}/${layout.id}/${slug(row.block)}`,
          detail: row.flow ?? row.block,
        });
      }
    }

    for (const page of [...app.pages, ...app.screens]) {
      for (const row of page.blocks) {
        list.push({
          type: "block",
          id: `${appId}/${page.id}/${slug(row.block)}`,
          detail: row.flow ?? row.block,
        });
      }
    }
  }

  for (const page of facts.pages) {
    list.push({
      type: "page",
      id: `${siteApp(snapshot, page.site)} ${page.route}`,
      detail: page.file,
    });
  }

  for (const app of facts.mobile) {
    for (const screen of app.screens) {
      list.push({
        type: "screen",
        id: `${mobileApp(snapshot, app.id)} ${screen.route}`,
        detail: screen.file,
      });
    }
  }

  for (const route of facts.routes ?? []) {
    if (route.isPage) continue;

    list.push({ type: "route", id: `${route.method} ${route.path}`, detail: route.name });
  }

  for (const thing of facts.named) {
    if (thing.type !== "mail" && thing.type !== "job") continue;

    list.push({ type: thing.type, id: thing.name, detail: thing.file });
  }

  for (const file of facts.files) {
    list.push({ type: "file", id: file.file, detail: file.about });

    for (const entry of file.exports) {
      if (entry.name === "default" || entry.name === "*") continue;

      list.push({ type: "export", id: `${file.file}#${entry.name}`, detail: entry.about });
    }
  }

  for (const task of [
    ...snapshot.collected.tasksIndex.open,
    ...snapshot.collected.tasksIndex.done,
  ]) {
    list.push({ type: "task", id: task.id, detail: task.title });
  }

  return list;
}

/** Whether every character of `needle` appears in `text` in order. */
function isSubsequence(needle: string, text: string): boolean {
  let position = 0;

  for (const char of text) {
    if (char === needle[position]) position++;

    if (position === needle.length) return true;
  }

  return needle.length === 0;
}

/** Shortest query that may match by fuzzy (in-order letters), so short queries stay precise. */
const FUZZY_MIN = 4;

/** Added to the score of written content (features, flows) so it ranks above files and exports of the same match. */
const WRITTEN_BOOST = 2;

/** Whether a word list holds a word that is, or starts with, every token (a short token must equal a word). */
function partMatches(partWords: readonly string[], tokens: readonly string[]): boolean {
  return tokens.every((token) =>
    partWords.some((word) => (token.length >= 3 ? word.startsWith(token) : word === token)),
  );
}

/** The first body part holding every token, as `label: text`, or `null`. */
function bodyMatch(candidate: Candidate, tokens: readonly string[], base: string): string | null {
  for (const part of candidate.body ?? []) {
    const partWords = words(part.text).split(" ");
    // Tokens may be split between the name and one written part.
    const rest = tokens.filter((token) => !base.includes(token));

    if (rest.length > 0 && partMatches(partWords, rest)) {
      const text = part.text.replace(/\s+/g, " ").trim();

      return `${part.label}: ${text.length > 90 ? `${text.slice(0, 89)}…` : text}`;
    }
  }

  return null;
}

/**
 * Score of a candidate for the query words, or 0 when it does not match. From best
 * to worst: exact name or path (7), prefix (6), whole-word match (5), substring of
 * the name or path (4), the words found only in the detail or in written text (3),
 * fuzzy (2). Features and flows add {@link WRITTEN_BOOST} to a match.
 */
function scoreOf(
  candidate: Candidate,
  query: string,
  tokens: readonly string[],
): { score: number; matched: string | null } {
  const id = words(
    candidate.type === "export" ? (candidate.id.split("#")[1] ?? candidate.id) : candidate.id,
  );
  const last = words(lastSegment(candidate.id));
  const base = `${id} ${words(candidate.detail ?? "")}`;
  const boost = candidate.type === "feature" || candidate.type === "flow" ? WRITTEN_BOOST : 0;

  if (!tokens.every((token) => base.includes(token))) {
    const matched = bodyMatch(candidate, tokens, base);

    if (matched !== null) return { score: 3 + boost, matched };

    const squeezed = id.replace(/ /g, "");

    return query.length >= FUZZY_MIN && tokens.every((token) => isSubsequence(token, squeezed))
      ? { score: 2, matched: null }
      : { score: 0, matched: null };
  }

  if (id === query || last === query) return { score: 7 + boost, matched: null };
  if (id.startsWith(query) || last.startsWith(query)) return { score: 6 + boost, matched: null };

  const idWords = id.split(" ");

  if (tokens.every((token) => idWords.includes(token))) return { score: 5 + boost, matched: null };
  if (tokens.every((token) => id.includes(token))) return { score: 4 + boost, matched: null };

  return { score: 3 + boost, matched: null };
}

/** The most hits of features and flows set aside before files and exports fill the list (a share of the limit). */
const WRITTEN_SHARE = 0.75;

const byRank = (left: ScryHit, right: ScryHit): number =>
  right.score - left.score ||
  TYPE_ORDER.indexOf(left.type) - TYPE_ORDER.indexOf(right.type) ||
  byText(left.id, right.id);

/**
 * The hits to return: the best features and flows first (up to a share of the
 * limit, so files and exports never push matching written content out), then
 * the best of the rest. Grouped by type in {@link TYPE_ORDER}, best first.
 */
function pickHits(hits: ScryHit[], limit: number): ScryHit[] {
  const ranked = [...hits].sort(byRank);
  const written = ranked
    .filter((hit) => hit.type === "feature" || hit.type === "flow")
    .slice(0, Math.max(1, Math.ceil(limit * WRITTEN_SHARE)));
  const chosen = new Set(written);

  for (const hit of ranked) {
    if (chosen.size >= limit) break;

    chosen.add(hit);
  }

  return [...chosen]
    .slice(0, limit)
    .sort(
      (left, right) =>
        TYPE_ORDER.indexOf(left.type) - TYPE_ORDER.indexOf(right.type) ||
        right.score - left.score ||
        byText(left.id, right.id),
    );
}

function scrySearch(
  snapshot: GrimoireSnapshot,
  query: Extract<ScryQuery, { type: "search" }>,
): ScrySearchResult {
  const text = words(query.text);
  const tokens = text.split(" ").filter((token) => token !== "");

  if (tokens.length === 0) {
    throw new GrimoireError(
      "GR9006",
      `Search text ${JSON.stringify(query.text)} has no letters or digits; pass a word to look for.`,
    );
  }

  const seen = new Set<string>();
  const hits: ScryHit[] = [];

  for (const candidate of candidates(snapshot)) {
    const key = `${candidate.type} ${candidate.id}`;

    if (seen.has(key)) continue;

    seen.add(key);

    const { score, matched } = scoreOf(candidate, text, tokens);

    if (score > 0) {
      hits.push({
        type: candidate.type,
        id: candidate.id,
        detail: candidate.detail,
        score,
        ...(matched === null ? {} : { matched }),
      });
    }
  }

  const counts: Partial<Record<ScryHitType, number>> = {};

  for (const hit of hits) counts[hit.type] = (counts[hit.type] ?? 0) + 1;

  return {
    type: "search",
    ...notesOf(snapshot, false),
    text: query.text,
    counts,
    hits: pickHits(hits, query.limit ?? 20),
  };
}

/**
 * Answer one query. Throws a `GrimoireError`: `GR9001` for a file not in the
 * book, `GR9002` no route, `GR9003` no feature, `GR9004` no flow, `GR9006`
 * a search with no words. Pure.
 */
export function scry(snapshot: GrimoireSnapshot, query: ScryQuery): ScryResult {
  switch (query.type) {
    case "file":
      return scryFile(snapshot, query);
    case "impact":
      return scryImpact(snapshot, query);
    case "route":
      return scryRoute(snapshot, query);
    case "feature":
      return scryFeature(snapshot, query);
    case "flow":
      return scryFlow(snapshot, query);
    case "search":
      return scrySearch(snapshot, query);
  }
}
