/**
 * The compact text of a scry answer: a title line, then `label  value` lines
 * with the labels in one column. Empty sections are left out.
 */
import type { FlowBookmapCriterion, FlowBookmapStep } from "../contracts/bookmap";
import type { CriterionStatus } from "../contracts/test-results";
import type { GrimoireFinding } from "../contracts/findings";
import type {
  ScryFeatureResult,
  ScryFileResult,
  ScryFlowResult,
  ScryImpactResult,
  ScryResult,
  ScryRouteResult,
  ScrySearchResult,
} from "../contracts/scry";
import type { WrittenChangelogEntry } from "../contracts/written";

const LABEL = 10;

/** `label` padded to the column, then the first value; more values go on indented lines. */
function section(label: string, values: readonly string[], width = LABEL): string[] {
  if (values.length === 0) return [];

  const pad = " ".repeat(Math.max(width, label.length + 1));

  return values.map((value, index) =>
    index === 0 ? `${label.padEnd(pad.length)}${value}` : `${pad}${value}`,
  );
}

/** Longest list a text section prints before it says how many more there are. */
const SECTION_CAP = 20;

/** What the text formatters may be told. */
export type FormatScryOptions = {
  /** Print every line of every section, not the first 20. */
  all?: boolean;
};

/** A section whose heading carries the count (`routes (3)`) and whose list stops at the cap. */
function countedSection(
  label: string,
  values: readonly string[],
  options: FormatScryOptions,
  width: number,
): string[] {
  const shown = options.all === true ? values : values.slice(0, SECTION_CAP);
  const lines = section(`${label} (${values.length})`, shown, width);

  if (shown.length < values.length) {
    lines.push(
      `${" ".repeat(Math.max(width, label.length + 1))}… and ${values.length - shown.length} more (--all lists every one)`,
    );
  }

  return lines;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Cut text at a word so it fits `max` characters, ending with ` …`. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;

  const words = text.split(" ");
  let kept = "";

  for (const word of words) {
    const next = kept === "" ? word : `${kept} ${word}`;

    if (next.length + 2 > max) break;

    kept = next;
  }

  return `${kept === "" ? text.slice(0, max - 2) : kept} …`;
}

function notes(result: ScryResult): string[] {
  return section("note", result.notes);
}

function countsLine(findings: readonly GrimoireFinding[]): string {
  const errors = findings.filter(
    (finding) => !finding.expected && finding.severity === "error",
  ).length;
  const warnings = findings.filter(
    (finding) => !finding.expected && finding.severity === "warning",
  ).length;
  const expected = findings.filter((finding) => finding.expected).length;

  return `${plural(errors, "error")}, ${plural(warnings, "warning")}, ${expected} expected`;
}

function releaseOf(entry: WrittenChangelogEntry): string {
  return entry.release === null ? "unreleased" : `${entry.release}, ${entry.date ?? "no date"}`;
}

function formatFile(result: ScryFileResult): string[] {
  const entry = result.entry;
  const feature =
    entry.feature === null && entry.borrowedBy.length === 0
      ? []
      : [
          `${entry.feature ?? "none"}${entry.borrowedBy.length > 0 ? ` (borrowed by: ${entry.borrowedBy.join(", ")})` : ""}`,
        ];
  const exportWidth = Math.max(0, ...entry.exports.map((item) => item.name.length));

  return [
    `${entry.file}  ${entry.type}  ${plural(entry.lines, "line")}`,
    ...section("about", entry.about === null ? [] : [entry.about]),
    ...section("feature", feature),
    ...section("flows", entry.flows),
    ...section(
      "exports",
      entry.exports.map((item) =>
        item.about === null ? item.name : `${item.name.padEnd(exportWidth)}  ${item.about}`,
      ),
    ),
    ...section("packages", entry.packages.length > 0 ? [entry.packages.join("  ")] : []),
    ...section("imports", entry.imports),
    ...section("used by", entry.importedBy),
    ...section(
      "routes",
      entry.routes.map(
        (route) =>
          `${route.method} ${route.path}${route.via === "handles" ? "  (handles)" : "  (registers)"}`,
      ),
    ),
    ...section(
      "pages",
      entry.pages.map((page) => `${page.site} ${page.route}  (${page.via})`),
    ),
    ...section(
      "screens",
      entry.screens.map((screen) => `${screen.app} ${screen.route}  (${screen.via})`),
    ),
    ...section("entry", result.bookEntry === null ? [] : [result.bookEntry]),
    ...notes(result),
  ];
}

function formatImpact(result: ScryImpactResult, options: FormatScryOptions): string[] {
  const width = 14;

  return [
    `impact of ${result.file}`,
    `${"importers".padEnd(width)}${result.importers.direct.length} direct, ${result.importers.all.length} in all`,
    ...countedSection(
      "routes",
      result.routes.map((route) => `${route.method} ${route.path}`),
      options,
      width,
    ),
    ...countedSection(
      "pages",
      result.pages.map((page) => `${page.app} ${page.route}`),
      options,
      width,
    ),
    ...countedSection("flows", result.flows, options, width),
    ...countedSection(
      "features",
      result.features.map((feature) => `${feature.id} (${feature.via})`),
      options,
      width,
    ),
    ...countedSection("tests", result.tests, options, width),
    ...notes(result),
  ];
}

function formatRoute(result: ScryRouteResult): string[] {
  const route = result.route;
  const width = 12;

  if (route === null) {
    const first = result.pages[0];

    return [
      first === undefined ? "page" : `GET ${first.route}  (${first.type})`,
      ...section(
        "pages",
        result.pages.map((page) => `${page.app} ${page.route}  ${page.file}`),
        width,
      ),
      ...section(
        "setup",
        result.pages.flatMap((page) => (page.setupFile === null ? [] : [page.setupFile])),
        width,
      ),
      ...section("layouts", [...new Set(result.pages.flatMap((page) => page.layouts))], width),
      ...section("files", result.files, width),
      ...notes(result),
    ];
  }

  const auth = route.auth.required
    ? `required (${route.auth.userTypes.length > 0 ? route.auth.userTypes.join(", ") : "any user"})`
    : "none";

  return [
    `${route.method} ${route.path}${route.name === null ? "" : `  ${route.name}`}`,
    ...section(
      "handler",
      [`${route.handler}${route.handlerFile === null ? "" : `  ${route.handlerFile}`}`],
      width,
    ),
    ...section("registered", route.sourceFile === null ? [] : [route.sourceFile], width),
    ...section(
      "middleware",
      route.middleware.length > 0 ? [route.middleware.join("  ")] : [],
      width,
    ),
    ...section("auth", [auth], width),
    ...section("description", route.description === null ? [] : [route.description], width),
    ...section(
      "page",
      result.page === null ? [] : [`${result.page.site} ${result.page.route}  ${result.page.file}`],
      width,
    ),
    ...section("files", result.files, width),
    ...section(
      "steps",
      result.steps.map((step) => `${step.flow} step ${step.index}`),
      width,
    ),
    ...notes(result),
  ];
}

function changeLine(entry: WrittenChangelogEntry): string {
  const text = `${entry.flow === null ? "" : `${entry.flow}: `}${entry.text}`;

  return `${entry.version.value} ${entry.word} ${shorten(text, 60)} (${releaseOf(entry)})`;
}

function formatFeature(result: ScryFeatureResult): string[] {
  const readme = result.readme;
  const bookmap = result.bookmap;
  const idWidth = Math.max(0, ...result.flows.map((flow) => flow.id.length));
  const statusWidth = Math.max(0, ...result.flows.map((flow) => flow.status.length));
  const pages = Object.entries(bookmap.pages)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap(([app, list]) => list.map((page) => `${app} ${page.route}`));
  const apps = readme.apps.map((app) => app.value);

  return [
    [
      readme.id.value,
      readme.title.value,
      `${readme.status.value} ${readme.version.value}`,
      `updated ${readme.updated.value}`,
      ...(apps.length > 0 ? [`apps ${apps.join(", ")}`] : []),
    ].join("  "),
    ...section(
      "flows",
      result.flows.map(
        (flow) =>
          `${flow.id.padEnd(idWidth)}  ${flow.status.padEnd(statusWidth)} since ${flow.since}`,
      ),
    ),
    ...section("own", [
      `${plural(bookmap.own.length, "file")}  (unreached: ${bookmap.unreached.length === 0 ? "none" : bookmap.unreached.length})`,
    ]),
    ...section("unreached", bookmap.unreached),
    ...section(
      "borrows",
      bookmap.borrowed.map((item) => item.file),
    ),
    ...section(
      "routes",
      bookmap.routes.length > 0
        ? [bookmap.routes.map((route) => `${route.method} ${route.path}`).join("  ")]
        : [],
    ),
    ...section("pages", pages.length > 0 ? [pages.join("  ")] : []),
    ...section("changes", result.changes.map(changeLine)),
    ...section(
      "tasks",
      result.tasks.map((task) => `${task.id} ${task.status}  ${task.title}`),
    ),
    ...section("check", [countsLine(result.findings)]),
    ...notes(result),
  ];
}

const STATUS_TEXT: Record<CriterionStatus, string> = {
  pass: "pass",
  fail: "fail",
  stale: "stale",
  "not-run": "not run",
  "no-test": "no test",
};

/** ` (+12 reachable, 3 type-only)`: what a step reaches beyond its entry file; empty when nothing. */
function reachNote(step: FlowBookmapStep): string {
  const parts = [
    ...(step.files.length > 1 ? [`+${step.files.length - 1} reachable`] : []),
    ...(step.typeOnlyFiles.length > 0 ? [`${step.typeOnlyFiles.length} type-only`] : []),
  ];

  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

function stepLines(steps: readonly FlowBookmapStep[]): string[] {
  const typeWidth = Math.max(0, ...steps.map((step) => step.type.length));
  const targetWidth = Math.max(0, ...steps.map((step) => step.target.length));

  return steps.map((step) => {
    const where =
      step.found === false
        ? "not found"
        : step.entry === null
          ? step.found === null && step.type === "route"
            ? "no route facts"
            : "—"
          : `${step.entry}${reachNote(step)}`;

    return `${step.index}. ${step.type.padEnd(typeWidth)}  ${step.target.padEnd(targetWidth)} ${where}`;
  });
}

function criterionLines(criteria: readonly FlowBookmapCriterion[]): string[] {
  const labels = criteria.map(
    (criterion) => `${criterion.id}${criterion.app === null ? "" : ` [${criterion.app}]`}`,
  );
  const labelWidth = Math.max(0, ...labels.map((label) => label.length));
  const texts = criteria.map((criterion) => shorten(criterion.text, 36));
  const textWidth = Math.max(0, ...texts.map((text) => text.length));

  return criteria.map((criterion, index) => {
    const test = criterion.tests[0];
    const where =
      test === undefined
        ? ""
        : `${test.file}:${test.line}${criterion.tests.length > 1 ? ` (+${criterion.tests.length - 1})` : ""}`;
    const line = `${(labels[index] ?? "").padEnd(labelWidth)} ${STATUS_TEXT[criterion.status].padEnd(7)}   ${
      where === "" ? (texts[index] ?? "") : `${(texts[index] ?? "").padEnd(textWidth)}  ${where}`
    }`;

    return line.trimEnd();
  });
}

function formatFlow(result: ScryFlowResult): string[] {
  const flow = result.flow;
  const shown = result.bookmap.shownBy.map((item) => `${item.app} ${item.id}: ${item.block}`);

  return [
    [
      flow.ref,
      ...(flow.heading === null ? [] : [flow.heading.value]),
      `${flow.status.value} since ${flow.since.value}`,
      `who ${flow.who.value}`,
    ].join("  "),
    ...(flow.summary === null ? [] : [flow.summary]),
    ...stepLines(result.bookmap.steps),
    ...section(
      "differs",
      flow.differs.map((line) => `${line.name}: ${line.text}`),
    ),
    ...section(
      "not handled",
      flow.notHandled.map((line) => `${line.name}: ${line.text}`),
      12,
    ),
    ...section(
      "unknown",
      flow.unknowns.map((item) => item.text.replace(/^Unknown:\s*/, "")),
    ),
    ...criterionLines(result.bookmap.criteria),
    ...section("shown on", shown.length > 0 ? [shown.join("   ")] : []),
    ...section(
      "history",
      result.history.length > 0
        ? [
            result.history
              .map((entry) => `${entry.version.value} ${entry.word} (${releaseOf(entry)})`)
              .join("   "),
          ]
        : [],
    ),
    ...section("check", [countsLine(result.findings)]),
    ...notes(result),
  ];
}

/** One line telling what the limit cut, per type, or nothing when every match is listed. */
function truncatedLine(result: ScrySearchResult): string[] {
  const total = Object.values(result.counts).reduce((sum, count) => sum + (count ?? 0), 0);

  if (total <= result.hits.length) return [];

  const parts = Object.entries(result.counts).map(([type, count]) => `${count} ${type}`);

  return [
    `showing ${result.hits.length} of ${total} (${parts.join(", ")}); raise --limit for more`,
  ];
}

/** A score for print: one decimal, or none from 100 up. */
function scoreText(score: number): string {
  return score >= 100 ? score.toFixed(0) : score.toFixed(1);
}

/** How a file that changes with the top hits relates to them, in a few words. */
function alsoReason(change: NonNullable<ScrySearchResult["alsoChanges"]>[number]): string {
  const name = (id: string): string => id.split(/[\s#]/)[0]?.split("/").pop() ?? id;
  const first = name(change.via[0] ?? "");
  const more = change.via.length > 1 ? ` +${change.via.length - 1}` : "";

  switch (change.reason) {
    case "imports":
      return `imports ${first}${more}`;
    case "imported-by":
      return `imported by ${first}${more}`;
    case "step":
      return `step of ${change.via[0] ?? ""}${more}`;
    case "test":
      return "test";
  }
}

/** The `changes with the top hits:` block, at most 10 files (the answer's own cap), or nothing. */
function alsoChangesLines(result: ScrySearchResult): string[] {
  const list = result.alsoChanges ?? [];

  if (list.length === 0) return [];

  const width = Math.min(60, Math.max(...list.map((change) => change.file.length)));

  return [
    "changes with the top hits:",
    ...list.map((change) => `  ${change.file.padEnd(width)}   ${alsoReason(change)}`),
  ];
}

/** The top file's impact, folded into the search answer (what reaches it), or nothing when it adds nothing. */
function impactLines(result: ScrySearchResult): string[] {
  const impact = result.impact;

  if (impact === undefined) return [];

  const rows: [string, string][] = [];

  if (impact.files.length > 0) {
    rows.push([
      "files",
      impact.files.join(", ") + (impact.more > 0 ? `, +${impact.more} more` : ""),
    ]);
  }
  if (impact.routes.length > 0) rows.push(["routes", impact.routes.join(", ")]);
  if (impact.flows.length > 0) rows.push(["flows", impact.flows.join(", ")]);
  if (impact.tests.length > 0) rows.push(["tests", impact.tests.join(", ")]);

  if (rows.length === 0) return [];

  return [
    `impact of ${impact.file}:`,
    ...rows.map(([label, text]) => `  ${label.padEnd(6)} ${text}`),
  ];
}

/** Hits in score order, one line each: `score type id  detail  (app)  [matched]`. */
function formatSearch(result: ScrySearchResult): string[] {
  if (result.hits.length === 0)
    return [`no match for ${JSON.stringify(result.text)}`, ...notes(result)];

  const scoreWidth = Math.max(...result.hits.map((hit) => scoreText(hit.score).length));
  const idWidth = Math.min(32, Math.max(0, ...result.hits.map((hit) => hit.id.length)));

  return [
    ...result.hits.map((hit) => {
      const head = `${scoreText(hit.score).padStart(scoreWidth)}  ${hit.type.padEnd(9)}`;
      // Page, screen and block ids start with the app; a file's app is not in its path.
      const app = hit.app !== undefined && hit.type === "file" ? `  (${hit.app})` : "";
      const line =
        hit.detail === null
          ? `${head}${hit.id}${app}`
          : `${head}${hit.id.padEnd(idWidth)}  ${hit.detail}${app}`;

      return line.trimEnd() + (hit.matched === undefined ? "" : `   [${hit.matched}]`);
    }),
    ...truncatedLine(result),
    ...alsoChangesLines(result),
    ...(result.weak === true
      ? ["weak match: no hit holds most of the request's words; use grep for literal text"]
      : []),
    ...impactLines(result),
    // The impact above is the same answer as `--impact`; the command is offered only when it is not in the output.
    ...(result.next === undefined || result.impact !== undefined ? [] : [`next: ${result.next}`]),
    ...notes(result),
  ];
}

/**
 * The compact text of a result (formats in the commands guide). Long lists in an
 * impact answer stop after 20 lines with a count; `options.all` prints them all.
 */
export function formatScryResult(result: ScryResult, options: FormatScryOptions = {}): string[] {
  switch (result.type) {
    case "file":
      return formatFile(result);
    case "impact":
      return formatImpact(result, options);
    case "route":
      return formatRoute(result);
    case "feature":
      return formatFeature(result);
    case "flow":
      return formatFlow(result);
    case "search":
      return formatSearch(result);
  }
}
