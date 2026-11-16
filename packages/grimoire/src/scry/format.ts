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

function formatFile(result: ScryFileResult & { bookEntry?: string | null }): string[] {
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
    ...section("entry", typeof result.bookEntry === "string" ? [result.bookEntry] : []),
    ...notes(result),
  ];
}

function formatImpact(result: ScryImpactResult): string[] {
  return [
    `impact of ${result.file}`,
    `${"importers".padEnd(11)}${result.importers.direct.length} direct, ${result.importers.all.length} in all`,
    ...section(
      "routes",
      result.routes.length > 0
        ? [result.routes.map((route) => `${route.method} ${route.path}`).join("  ")]
        : [],
      11,
    ),
    ...section(
      "pages",
      result.pages.length > 0
        ? [result.pages.map((page) => `${page.app} ${page.route}`).join("  ")]
        : [],
      11,
    ),
    ...section("flows", result.flows.length > 0 ? [result.flows.join("  ")] : [], 11),
    ...section(
      "features",
      result.features.length > 0
        ? [result.features.map((feature) => `${feature.id} (${feature.via})`).join("  ")]
        : [],
      11,
    ),
    ...section("tests", result.tests.length > 0 ? [result.tests.join("  ")] : [], 11),
    ...notes(result),
  ];
}

function formatRoute(result: ScryRouteResult): string[] {
  const route = result.route;
  const width = 12;
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

function stepLines(steps: readonly FlowBookmapStep[]): string[] {
  const kindWidth = Math.max(0, ...steps.map((step) => step.kind.length));
  const targetWidth = Math.max(0, ...steps.map((step) => step.target.length));

  return steps.map((step) => {
    const where =
      step.found === false
        ? "not found"
        : step.entry === null
          ? step.found === null && step.kind === "route"
            ? "no route facts"
            : "—"
          : `${step.entry}${step.files.length > 1 ? ` (+${step.files.length - 1} files)` : ""}`;

    return `${step.index}. ${step.kind.padEnd(kindWidth)}  ${step.target.padEnd(targetWidth)} ${where}`;
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

function formatSearch(result: ScrySearchResult): string[] {
  if (result.hits.length === 0)
    return [`no match for ${JSON.stringify(result.text)}`, ...notes(result)];

  const idWidth = Math.min(32, Math.max(0, ...result.hits.map((hit) => hit.id.length)));

  return [
    ...result.hits.map((hit) =>
      (hit.detail === null
        ? `${hit.type.padEnd(9)}${hit.id}`
        : `${hit.type.padEnd(9)}${hit.id.padEnd(idWidth)}  ${hit.detail}`
      ).trimEnd(),
    ),
    ...notes(result),
  ];
}

/** The compact text of a result (formats in the commands guide). */
export function formatScryResult(result: ScryResult): string[] {
  switch (result.type) {
    case "file":
      return formatFile(result);
    case "impact":
      return formatImpact(result);
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
