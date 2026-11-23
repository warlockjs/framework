/**
 * The product map answers: the Grimoire in plain words for readers who do
 * not read code. Built from the written files, the book maps, the test
 * results, the open tasks, the changelogs and (when the devtools monitor
 * reports them) the captured errors. A shared answer (`options.shared`)
 * carries no file paths, code or test names.
 */
import { checkGrimoire } from "../check";
import { normalizeRoutePath } from "../bookmap";
import type { FlowBookmap, FlowBookmapCriterion } from "../contracts/bookmap";
import type { GrimoireCheckReport } from "../contracts/findings";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type {
  WrittenApp,
  WrittenFeature,
  WrittenFlow,
  WrittenScreenshot,
  WrittenStep,
} from "../contracts/written";
import { compactStep, flowOrder, neighboursOf } from "../scry/compact";
import type {
  ProductAppearance,
  ProductFeatureAnswer,
  ProductFeatureCard,
  ProductFlowAnswer,
  ProductFlowCard,
  ProductHealth,
  ProductMapAnswer,
  ProductPlannedItem,
  ProductRelease,
  ProductScreenshot,
  ProductStrip,
  ProductStoryStep,
  ProductWhatsNewAnswer,
  ProductWhatsNewRelease,
} from "./answers";
import { GrimoirePanelError } from "./data";

/** One captured error group as devtools hands it to a panel: counts only. */
export type ProductErrorSummary = {
  /** The route pattern (`/products/:id`), or `null` outside a request. */
  route: string | null;
  status: number | null;
  name: string | null;
  source: "request" | "log";
  count: number;
  firstSeen: number;
  lastSeen: number;
};

/** How the product map answers are built. */
export type ProductMapOptions = {
  /** `true` for a read-only share link: no developer detail. */
  shared: boolean;
  /** Captured error groups, or `null` when the monitor reports none. */
  errors: readonly ProductErrorSummary[] | null;
};

/** How far back captured errors count (one hour). */
const ERROR_WINDOW_MS = 3_600_000;

type ErrorCount = { count: number; lastSeen: number };

/** Everything the answers share, computed once per request. */
type Context = {
  snapshot: GrimoireSnapshot;
  options: ProductMapOptions;
  report: GrimoireCheckReport;
  featureErrors: Map<string, number>;
  flowErrors: Map<string, number>;
  /** Unexpected findings by feature id. */
  featureFindings: Map<string, { errors: number; warnings: number }>;
  captured: { features: Map<string, ErrorCount>; flows: Map<string, ErrorCount> } | null;
  resultsMissing: boolean;
};

function addCount(map: Map<string, ErrorCount>, key: string, group: ProductErrorSummary): void {
  const known = map.get(key);

  map.set(key, {
    count: (known?.count ?? 0) + group.count,
    lastSeen: Math.max(known?.lastSeen ?? 0, group.lastSeen),
  });
}

/** Map the last hour's error groups to the features and flows that use their route. */
function captureErrors(
  snapshot: GrimoireSnapshot,
  errors: readonly ProductErrorSummary[],
  now: number,
): NonNullable<Context["captured"]> {
  const features = new Map<string, ErrorCount>();
  const flows = new Map<string, ErrorCount>();
  const routes = snapshot.book.facts.routes ?? [];

  for (const group of errors) {
    if (group.route === null || group.lastSeen < now - ERROR_WINDOW_MS) continue;

    const path = normalizeRoutePath(group.route);

    for (const route of routes) {
      if (normalizeRoutePath(route.path) !== path) continue;

      const file = route.handlerFile ?? route.sourceFile;
      const owner = file === null ? null : (snapshot.ownership.files[file]?.owner ?? null);

      if (owner !== null) addCount(features, owner, group);
    }

    for (const feature of snapshot.written.features) {
      for (const flow of feature.flows) {
        const hit = flow.steps.some(
          (step) =>
            (step.type === "route" &&
              step.route !== null &&
              normalizeRoutePath(step.route.path) === path) ||
            (step.type === "page" && normalizeRoutePath(step.target) === path),
        );

        if (hit) addCount(flows, flow.ref, group);
      }
    }
  }

  return { features, flows };
}

/**
 * The check report of a snapshot, run once per snapshot. A share link reaches
 * these answers without an account, so a page view must not run the whole
 * check again; a changed book opens a new snapshot and a new report.
 */
const reports = new WeakMap<GrimoireSnapshot, GrimoireCheckReport>();

function reportOf(snapshot: GrimoireSnapshot): GrimoireCheckReport {
  let report = reports.get(snapshot);

  if (report === undefined) {
    report = checkGrimoire(snapshot);
    reports.set(snapshot, report);
  }

  return report;
}

function contextOf(snapshot: GrimoireSnapshot, options: ProductMapOptions): Context {
  const report = reportOf(snapshot);
  const featureErrors = new Map<string, number>();
  const flowErrors = new Map<string, number>();
  const featureFindings = new Map<string, { errors: number; warnings: number }>();

  for (const finding of report.findings) {
    if (finding.expected) continue;

    const owner = finding.subject.feature ?? finding.subject.flow?.split("/")[0] ?? null;

    if (owner !== null) {
      const known = featureFindings.get(owner) ?? { errors: 0, warnings: 0 };

      if (finding.severity === "error") known.errors += 1;
      else known.warnings += 1;

      featureFindings.set(owner, known);
    }

    if (finding.severity !== "error") continue;

    const flow = finding.subject.flow;
    const feature = finding.subject.feature ?? flow?.split("/")[0] ?? null;

    if (feature !== null) featureErrors.set(feature, (featureErrors.get(feature) ?? 0) + 1);
    if (flow !== null) flowErrors.set(flow, (flowErrors.get(flow) ?? 0) + 1);
  }

  return {
    snapshot,
    options,
    report,
    featureErrors,
    flowErrors,
    featureFindings,
    captured: options.errors === null ? null : captureErrors(snapshot, options.errors, Date.now()),
    resultsMissing: snapshot.results === null && snapshot.proofs.length > 0,
  };
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The traffic light and its sentence (the rules of the product map). */
function healthOf(
  context: Context,
  criteria: readonly Pick<FlowBookmapCriterion, "status">[],
  checkErrors: number,
  captured: ErrorCount | undefined,
): ProductHealth {
  const counts = { total: criteria.length, pass: 0, fail: 0, stale: 0, notRun: 0, noTest: 0 };

  for (const criterion of criteria) {
    if (criterion.status === "pass") counts.pass += 1;
    else if (criterion.status === "fail") counts.fail += 1;
    else if (criterion.status === "stale") counts.stale += 1;
    else if (criterion.status === "not-run") counts.notRun += 1;
    else counts.noTest += 1;
  }

  const errors =
    context.captured === null
      ? null
      : { count: captured?.count ?? 0, lastSeen: captured?.lastSeen ?? null };
  const recent = errors?.count ?? 0;
  const total = counts.total;
  let level: ProductHealth["level"];
  let reason: string;

  if (counts.fail > 0) {
    level = "problem";
    reason = `${counts.fail} of ${total} checks fail`;
  } else if (checkErrors > 0) {
    level = "problem";
    reason = `The check found ${plural(checkErrors, "error")}`;
  } else if (counts.noTest > 0) {
    level = "attention";
    reason = `${counts.noTest} of ${total} checks have no test`;
  } else if (context.resultsMissing && total > 0) {
    // A missing results file is a missing measurement, not a product problem: a shared (business) view shows it neutral.
    if (context.options.shared) {
      level = "unknown";
      reason = "Test results are not measured";
    } else {
      level = "attention";
      reason = "No test results recorded";
    }
  } else if (counts.stale > 0 || counts.notRun > 0) {
    level = "attention";
    reason = "Tests have not run since they changed";
  } else if (recent > 0) {
    level = "attention";
    reason = `${plural(recent, "error")} in the last hour`;
  } else if (total > 0) {
    level = "good";
    reason = `All ${total} checks pass`;
  } else {
    level = "unknown";
    reason = "No checks written yet";
  }

  return { level, reason, criteria: counts, errors };
}

function featureHealth(context: Context, feature: WrittenFeature): ProductHealth {
  const criteria = feature.flows.flatMap(
    (flow) => context.snapshot.collected.flows[flow.ref]?.criteria ?? [],
  );

  return healthOf(
    context,
    criteria,
    context.featureErrors.get(feature.id) ?? 0,
    context.captured?.features.get(feature.id),
  );
}

function flowHealthOf(context: Context, flow: WrittenFlow): ProductHealth {
  return healthOf(
    context,
    context.snapshot.collected.flows[flow.ref]?.criteria ?? [],
    context.flowErrors.get(flow.ref) ?? 0,
    context.captured?.flows.get(flow.ref),
  );
}

function findFeature(snapshot: GrimoireSnapshot, id: string | undefined): WrittenFeature {
  if (id === undefined || id === "") throw new GrimoirePanelError(400, 'Missing "feature".');

  const feature = snapshot.written.features.find((item) => item.id === id);

  if (feature === undefined || feature.readme === null) {
    throw new GrimoirePanelError(404, `No feature "${id}" is written in grimoire/features.`);
  }

  return feature;
}

function audienceOf(feature: WrittenFeature): string[] {
  const listed = (feature.readme?.audience ?? []).map((item) => item.value);

  if (listed.length > 0) return listed;

  return [...new Set(feature.flows.map((flow) => flow.who.value))];
}

/** The health strip numbers of a feature card. */
function stripOf(context: Context, feature: WrittenFeature, health: ProductHealth): ProductStrip {
  const bookmaps = feature.flows.flatMap((flow) => {
    const found = context.snapshot.collected.flows[flow.ref];

    return found === undefined ? [] : [found];
  });
  const places = appearancesOf(context.snapshot, bookmaps);

  return {
    flows: {
      total: feature.flows.length,
      shipped: feature.flows.filter((flow) => flow.status.value === "shipped").length,
    },
    criteria: {
      total: health.criteria.total,
      proven: health.criteria.pass,
      failing: health.criteria.fail,
      // Nothing is measured when no result was recorded, or none of the criteria has a result yet.
      measured:
        !context.resultsMissing &&
        (health.criteria.total === 0 ||
          health.criteria.pass + health.criteria.fail + health.criteria.stale > 0 ||
          health.criteria.notRun === 0),
    },
    screenshots: {
      places: places.length,
      present: places.filter((place) => place.screenshots.length > 0).length,
    },
    findings: context.featureFindings.get(feature.id) ?? { errors: 0, warnings: 0 },
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Only a real `YYYY-MM-DD` day counts as a change date; a bad `updated:` value is ignored here (check reports it). */
const isDay = (value: string): boolean =>
  DAY.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

/** Compares release names by their numeric parts, so `5.9.0` comes before `5.10.0`. */
export function compareReleases(left: string, right: string): number {
  const parts = (value: string) => value.split(/[.\-+]/).map((part) => part);
  const a = parts(left);
  const b = parts(right);

  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index] ?? "0";
    const y = b[index] ?? "0";
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    const diff = numeric ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0;

    if (diff !== 0) return diff;
  }

  return 0;
}

function card(context: Context, feature: WrittenFeature): ProductFeatureCard {
  const readme = feature.readme;

  if (readme === null) throw new Error("A feature card needs a README.");

  const health = featureHealth(context, feature);
  const entries = feature.changelog?.entries ?? [];
  const dates = [
    readme.updated.value,
    ...entries.flatMap((entry) => (entry.date === null ? [] : [entry.date])),
  ].filter(isDay);

  return {
    changedAt: dates.reduce((newest, date) => (date > newest ? date : newest), ""),
    changedIn: [
      ...new Set(entries.flatMap((entry) => (entry.release === null ? [] : [entry.release]))),
    ],
    unreleased: entries.some((entry) => entry.release === null),
    id: feature.id,
    title: readme.title.value,
    summary: readme.summary,
    audience: audienceOf(feature),
    apps: readme.apps.map((app) => app.value),
    status: readme.status.value,
    version: readme.version.value,
    flows: feature.flows.length,
    health,
    strip: stripOf(context, feature, health),
  };
}

/** `GET /product`: the feature map. */
export function productMap(
  snapshot: GrimoireSnapshot,
  options: ProductMapOptions,
): ProductMapAnswer {
  const context = contextOf(snapshot, options);

  return {
    builtAt: snapshot.book.manifest.builtAt,
    features: snapshot.written.features
      .filter((feature) => feature.readme !== null)
      .map((feature) => card(context, feature)),
    apps: snapshot.written.apps.map((app) => ({
      id: app.id.value,
      type: app.type.value,
      title: app.heading?.value ?? null,
    })),
    releases: snapshot.written.releases
      .map((item) => ({ release: item.release.value, date: item.date.value }))
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) || compareReleases(left.release, right.release),
      ),
    developer: !options.shared,
    host: snapshot.host ?? null,
  };
}

const slugOf = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function screenshotsOf(items: readonly WrittenScreenshot[]): ProductScreenshot[] {
  return items.flatMap((item) => (item.path === null ? [] : [{ src: item.path, alt: item.alt }]));
}

/** Where the flows are shown, with the screenshots of the block (else of the page). */
function appearancesOf(
  snapshot: GrimoireSnapshot,
  bookmaps: readonly FlowBookmap[],
): ProductAppearance[] {
  const seen = new Set<string>();
  const list: ProductAppearance[] = [];
  const apps = new Map<string, WrittenApp>(snapshot.written.apps.map((app) => [app.id.value, app]));

  for (const bookmap of bookmaps) {
    for (const shown of bookmap.shownBy) {
      const key = `${shown.app}|${shown.type}|${shown.id}|${shown.block}|${bookmap.ref}`;

      if (seen.has(key)) continue;

      seen.add(key);

      const app = apps.get(shown.app);
      let title: string | null = null;
      let route: string | null = null;
      let screenshots: ProductScreenshot[] = [];

      if (app !== undefined && shown.type === "layout") {
        title = app.layouts.find((layout) => layout.id === shown.id)?.heading?.value ?? null;
      } else if (app !== undefined) {
        const page = [...app.pages, ...app.screens].find((item) => item.id === shown.id);

        if (page !== undefined) {
          title = page.heading?.value ?? null;
          route = page.route?.value ?? page.screen?.value ?? null;

          const block =
            page.blockFiles.find((item) => item.id === slugOf(shown.block)) ??
            page.blockFiles.find((item) => item.flow?.value === bookmap.ref);

          screenshots = screenshotsOf(block?.screenshots ?? []);

          if (screenshots.length === 0) screenshots = screenshotsOf(page.screenshots);
        }
      }

      list.push({
        app: shown.app,
        appTitle: app?.heading?.value ?? null,
        type: shown.type,
        id: shown.id,
        title,
        route,
        block: shown.block,
        flow: bookmap.ref,
        screenshots,
      });
    }
  }

  return list;
}

function releasesOf(snapshot: GrimoireSnapshot, feature: WrittenFeature): ProductRelease[] {
  const dates = new Map(
    snapshot.written.releases.map((item) => [item.release.value, item.date.value]),
  );
  const entries = feature.changelog?.entries ?? [];
  // Unreleased entries first, then the stamped ones in file order (newest first).
  const ordered = [
    ...entries.filter((entry) => entry.release === null),
    ...entries.filter((entry) => entry.release !== null),
  ];
  const groups = new Map<string, ProductRelease>();

  for (const entry of ordered) {
    const key = `${entry.version.value}|${entry.release ?? ""}`;
    let group = groups.get(key);

    if (group === undefined) {
      group = {
        version: entry.version.value,
        release: entry.release,
        date: entry.date ?? (entry.release === null ? null : (dates.get(entry.release) ?? null)),
        changes: [],
      };
      groups.set(key, group);
    }

    group.changes.push({ word: entry.word, flow: entry.flow, text: entry.text });
  }

  return [...groups.values()];
}

function plannedOf(snapshot: GrimoireSnapshot, feature: string): ProductPlannedItem[] {
  return snapshot.collected.tasksIndex.open
    .filter((task) => task.feature === feature)
    .map((task) => ({
      id: task.id,
      title: task.title,
      type: task.type,
      status: task.status,
      flow: task.flow === null ? null : task.flow.replace(`${feature}/`, ""),
    }));
}

function flowCard(context: Context, flow: WrittenFlow): ProductFlowCard {
  return {
    id: flow.id.value,
    ref: flow.ref,
    title: flow.heading?.value ?? flow.id.value,
    summary: flow.summary,
    who: flow.who.value,
    status: flow.status.value,
    health: flowHealthOf(context, flow),
  };
}

/** `GET /product/features/:feature`. */
export function productFeature(
  snapshot: GrimoireSnapshot,
  id: string | undefined,
  options: ProductMapOptions,
): ProductFeatureAnswer {
  const feature = findFeature(snapshot, id);
  const readme = feature.readme;

  if (readme === null) throw new Error("unreachable");

  const context = contextOf(snapshot, options);
  const bookmaps = feature.flows.flatMap((flow) => {
    const bookmap = snapshot.collected.flows[flow.ref];

    return bookmap === undefined ? [] : [bookmap];
  });
  const own = snapshot.collected.features[feature.id];
  const unexpected = context.report.findings.filter(
    (finding) => (finding.subject.feature ?? finding.subject.flow?.split("/")[0]) === feature.id,
  );
  const unexpectedNow = unexpected.filter((finding) => !finding.expected);
  const errors = unexpectedNow.filter((finding) => finding.severity === "error").length;

  return {
    feature: {
      id: feature.id,
      title: readme.title.value,
      summary: readme.summary,
      why: readme.why,
      audience: audienceOf(feature),
      apps: readme.apps.map((app) => app.value),
      status: readme.status.value,
      version: readme.version.value,
      updated: readme.updated.value,
      origin: readme.origin?.value ?? null,
    },
    flows: flowOrder(feature).map((flow) => flowCard(context, flow)),
    appearances: appearancesOf(snapshot, bookmaps),
    releases: releasesOf(snapshot, feature),
    planned: plannedOf(snapshot, feature.id),
    health: featureHealth(context, feature),
    host: snapshot.host ?? null,
    developer: options.shared
      ? null
      : {
          folders: readme.folders.map((folder) => folder.value),
          routes: (own?.routes ?? []).map(({ file: _file, ...route }) => route),
          files: own?.own.length ?? 0,
          findings: {
            errors,
            warnings: unexpectedNow.length - errors,
            expected: unexpected.length - unexpectedNow.length,
          },
        },
  };
}

const STEP_WORDS: Record<WrittenStep["type"], (target: string) => string> = {
  page: (target) => `Open ${target}`,
  route: () => "The server takes the request",
  mail: (target) => `An email "${target}" is sent`,
  notification: (target) => `A notification "${target}" is sent`,
  job: (target) => `The job "${target}" runs in the background`,
  event: (target) => `The event "${target}" happens`,
  "outside service": (target) => `The outside service "${target}" is used`,
  affects: (target) => `This also affects ${target}`,
};

function storyOf(flow: WrittenFlow): ProductStoryStep[] {
  if (flow.story.length > 0) {
    return flow.story.map((step) => ({
      index: step.index,
      text: step.text,
      screenshots: screenshotsOf(step.screenshots),
      derived: false,
    }));
  }

  return flow.steps.map((step) => ({
    index: step.index,
    text: step.note ?? STEP_WORDS[step.type](step.target),
    screenshots: [],
    derived: true,
  }));
}

const DOES_NOT_APPLY = /^does not apply\b[:\s—-]*/i;

/** `GET /product/flows/:feature/:flow`. */
export function productFlow(
  snapshot: GrimoireSnapshot,
  featureId: string | undefined,
  flowId: string | undefined,
  options: ProductMapOptions,
): ProductFlowAnswer {
  const feature = findFeature(snapshot, featureId);
  const flow = feature.flows.find((item) => item.id.value === flowId);

  if (flow === undefined) {
    throw new GrimoirePanelError(404, `No flow "${flowId ?? ""}" in feature "${feature.id}".`);
  }

  const context = contextOf(snapshot, options);
  const bookmap = snapshot.collected.flows[flow.ref];
  const { previous, next } = neighboursOf(feature, flow.id.value);

  return {
    flow: {
      ref: flow.ref,
      feature: feature.id,
      featureTitle: feature.readme?.title.value ?? feature.id,
      title: flow.heading?.value ?? flow.id.value,
      summary: flow.summary,
      who: flow.who.value,
      status: flow.status.value,
      since: flow.since.value,
    },
    story: storyOf(flow),
    proof: (bookmap?.criteria ?? []).map((criterion) => ({
      id: criterion.id,
      text: criterion.text,
      status: criterion.status,
      tests: options.shared ? null : criterion.tests,
    })),
    cases: flow.cases.map((item) => {
      const answer = item.doesNotApply
        ? item.answer.replace(DOES_NOT_APPLY, "").trim()
        : item.answer;

      return {
        question: item.question,
        answer: answer === "" ? "Does not apply" : answer,
        handled: !item.doesNotApply,
        criteria: item.criteria,
      };
    }),
    appearances: bookmap === undefined ? [] : appearancesOf(snapshot, [bookmap]),
    previous,
    next,
    health: flowHealthOf(context, flow),
    developer: options.shared
      ? null
      : {
          steps: (bookmap?.steps ?? []).map((step) => compactStep(snapshot, feature, step, flow)),
        },
    host: snapshot.host ?? null,
  };
}

/** A reference id: `AC-6`, `T-12`, `QA 1.5.6`. */
const REFERENCE = /^(?:[A-Z]{1,5}-\d+|QA\s+\d[\w.-]*)$/;
/** A trailing parenthesised group (optionally followed by one end mark) at the end of a sentence. */
const TRAILING_GROUP = /\s*\(([^()]*)\)\s*([.!?]?)\s*$/;

/** A sentence without the reference ids written in trailing parentheses: `"Fixed the total (AC-6, T-12)."` gives `"Fixed the total."`. */
function withoutReferences(sentence: string): string {
  let text = sentence;

  for (;;) {
    const match = TRAILING_GROUP.exec(text);

    if (match === null) break;

    const parts = (match[1] ?? "")
      .split(/[,;]/)
      .map((part) => part.trim())
      .filter((part) => part !== "");

    if (parts.length === 0 || !parts.every((part) => REFERENCE.test(part))) break;

    text = `${text.slice(0, match.index)}${match[2] ?? ""}`;
  }

  return text.trim();
}

/** The first paragraph of a release brief as one plain line, or `null`. */
function firstParagraph(brief: string): string | null {
  const paragraph = brief
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part !== "" && !part.startsWith("#"));

  if (paragraph === undefined) return null;

  const text = withoutReferences(paragraph.replace(/\s+/g, " ").replaceAll("`", ""));

  return text === "" ? null : text;
}

/** The newest release first; the changes without a release lead. */
function newestFirst(left: ProductWhatsNewRelease, right: ProductWhatsNewRelease): number {
  if (left.release === null || right.release === null)
    return Number(right.release === null) - Number(left.release === null);

  return (
    (right.date ?? "").localeCompare(left.date ?? "") ||
    compareReleases(right.release, left.release)
  );
}

/**
 * `GET /product/whats-new`: the changelog entries of every feature, grouped by
 * release and then by feature, in plain words (no criterion or task ids, no
 * paths). A release is one a changelog names or a file in `grimoire/releases`;
 * the changes that are in no release yet only appear in the signed-in view.
 */
export function productWhatsNew(
  snapshot: GrimoireSnapshot,
  options: ProductMapOptions,
): ProductWhatsNewAnswer {
  const written = new Map(snapshot.written.releases.map((item) => [item.release.value, item]));
  const releases = new Map<string, ProductWhatsNewRelease>();

  const releaseOf = (name: string | null, date: string | null): ProductWhatsNewRelease => {
    const key = name ?? "";
    let found = releases.get(key);

    if (found === undefined) {
      const file = name === null ? undefined : written.get(name);

      found = {
        release: name,
        date: file?.date.value ?? date,
        brief: file === undefined ? null : firstParagraph(file.brief),
        features: [],
      };
      releases.set(key, found);
    }

    return found;
  };

  for (const item of snapshot.written.releases) releaseOf(item.release.value, item.date.value);

  for (const feature of snapshot.written.features) {
    if (feature.readme === null) continue;

    const title = feature.readme.title.value;
    const flowTitles = new Map(
      feature.flows.map((flow) => [flow.id.value, flow.heading?.value ?? flow.id.value]),
    );

    for (const entry of feature.changelog?.entries ?? []) {
      if (entry.release === null && options.shared) continue;

      const release = releaseOf(entry.release, entry.date);
      let group = release.features.find((item) => item.id === feature.id);

      if (group === undefined) {
        group = { id: feature.id, title, changes: [] };
        release.features.push(group);
      }

      group.changes.push({
        word: entry.word,
        flow: entry.flow === null ? null : (flowTitles.get(entry.flow) ?? entry.flow),
        text: withoutReferences(entry.text),
      });
    }
  }

  return {
    releases: [...releases.values()]
      .filter((release) => release.release !== null || release.features.length > 0)
      .map((release) => ({
        ...release,
        features: [...release.features].sort((left, right) =>
          left.title.localeCompare(right.title),
        ),
      }))
      .sort(newestFirst),
    developer: !options.shared,
    host: snapshot.host ?? null,
  };
}
