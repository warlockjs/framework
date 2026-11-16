/**
 * The files of one feature folder: `README.md`, `CHANGELOG.md`,
 * `flows/<flow>.md` and `versions/v<n>.md`.
 */
import type { SourceLocation } from "../contracts/location";
import {
  CASE_QUESTIONS,
  type ChangeWord,
  type StepType,
  type WrittenCase,
  type WrittenChangelog,
  type WrittenChangelogEntry,
  type WrittenChangelogSection,
  type WrittenCriterion,
  type WrittenFeatureReadme,
  type WrittenFlow,
  type WrittenOrigin,
  type WrittenStatus,
  type WrittenStep,
  type WrittenVersionBrief,
} from "../contracts/written";
import { FrontMatterReader, ID, SEP, VERSION, checks, isDate, projectFolder } from "./fields";
import { BULLET, bulletLines, readListLines, splitListLine } from "./lists";
import {
  checkHeadings,
  findSection,
  lineAt,
  logicalLines,
  normalizeKey,
  paragraphAfterTitle,
  readDocument,
  type WrittenDocument,
} from "./markdown";
import type { FindingSink } from "./sink";

export const STATUSES: readonly WrittenStatus[] = ["proposed", "building", "shipped", "retired"];
export const ORIGINS: readonly WrittenOrigin[] = ["inferred", "confirmed"];
export const CHANGE_WORDS: readonly ChangeWord[] = ["added", "changed", "fixed", "removed"];
/** Step kinds, longest first so `outside service` is tried before shorter words. */
export const STEP_TYPES: readonly StepType[] = [
  "outside service",
  "notification",
  "affects",
  "event",
  "route",
  "page",
  "mail",
  "job",
];

/** A status that is missing or wrong is read as `building`: never `proposed`, which would hide findings. */
const FALLBACK_STATUS: WrittenStatus = "building";

// The parts of a step, a criterion and a changelog entry are split by spaces
// or tabs: two or more line them up, one is read too (a Markdown formatter
// collapses them).
const STEP = new RegExp(
  String.raw`^(\d+)\.[ \t]+(${STEP_TYPES.join("|")})[ \t]+(\S.*?)(?:[ \t]+(?:—|--)[ \t]+(\S.*))?$`,
);
const STEP_ANY_TYPE = new RegExp(String.raw`^(\d+)\.[ \t]+(\S.*?)${SEP}(\S.*)$`);
const STEP_FIRST_WORD = /^(\d+)\.[ \t]+(\S+)[ \t]+(\S.*)$/;
const NUMBERED = /^(\d+)\.(?:[ \t]|$)/;
const PAGE_TARGET = /^(\S+)[ \t]+\[([a-z0-9]+(?:-[a-z0-9]+)*)\]$/;
const ROUTE_TARGET = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ALL)[ \t]+(\/\S*)$/i;
const AFFECTS_TARGET = /^([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/([a-z0-9]+(?:-[a-z0-9]+)*))?$/;
const CRITERION = /^[-*][ \t]+AC-(\d+)(?:[ \t]+\[([a-z0-9-]+)\])?[ \t]+([^\s[].*)$/;
const CHANGELOG_ENTRY = /^[-*][ \t]+(\S+)[ \t]+(\S+)[ \t]+(\S.*)$/;
const RELEASE_HEADING = /^##[ \t]+(\S+)[ \t]+\((.+)\)$/;
const UNRELEASED_HEADING = /^##[ \t]+unreleased$/i;
const FLOW_PREFIX = /^([a-z0-9-]+):[ \t]+(\S.*)$/;
const CRITERIA_SUFFIX = /[ \t]*\((AC-\d+(?:[ \t]*,[ \t]*AC-\d+)*)\)$/;
const FLOW_REF_IN_TEXT =
  /(?<![\w/-])([a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*)(?![\w/-])/g;

function heading(document: WrittenDocument): WrittenFeatureReadme["heading"] {
  return document.title
    ? { value: document.title.text, at: lineAt(document.file, document.title.line) }
    : null;
}

/** GR1019 when a front matter id differs from the folder or file name it must equal. */
function sameAsName(
  located: { value: string; at: SourceLocation },
  name: string,
  what: string,
  sink: FindingSink,
): void {
  if (located.value !== "" && located.value !== name) {
    sink.report(
      "GR1019",
      `the ${what} ${JSON.stringify(located.value)} must equal its ${JSON.stringify(name)} name.`,
      located.at,
    );
  }
}

/** The text of a changelog entry: the flow prefix, the text and the trailing criteria. */
export function splitEntryText(text: string): {
  flow: string | null;
  criteria: string[];
  text: string;
} {
  let rest = text.trim();
  let flow: string | null = null;
  let criteria: string[] = [];
  const prefix = FLOW_PREFIX.exec(rest);

  if (prefix) {
    flow = prefix[1] ?? null;
    rest = prefix[2] ?? "";
  }

  const suffix = CRITERIA_SUFFIX.exec(rest);

  if (suffix) {
    criteria = (suffix[1] ?? "").split(",").map((criterion) => criterion.trim());
    rest = rest.slice(0, suffix.index).trimEnd();
  }

  return { flow, criteria, text: rest };
}

// ── README ─────────────────────────────────────────────────────────────────

/** `grimoire/features/<id>/README.md`. */
export function parseFeatureReadme(
  file: string,
  text: string,
  folder: string,
  sink: FindingSink,
): WrittenFeatureReadme {
  const document = readDocument(file, text, "required", sink);
  const fields = new FrontMatterReader(document, sink);

  fields.onlyKeys(
    ["id", "title", "status", "version", "updated", "apps", "folders", "origin"],
    "feature README",
  );

  const id = fields.required("id", checks.id);
  sameAsName(id, folder, "feature id", sink);

  const readme: WrittenFeatureReadme = {
    file,
    id,
    title: fields.required("title", checks.text),
    status: fields.oneOf("status", STATUSES, FALLBACK_STATUS),
    version: fields.required("version", checks.version),
    updated: fields.required("updated", checks.date),
    apps: fields.list("apps", { required: true, check: checks.id }),
    folders: fields.list("folders", {
      required: true,
      check: checks.folder,
      map: (value) => projectFolder(value) ?? value,
    }),
    origin: fields.optionalOneOf("origin", ORIGINS),
    heading: heading(document),
    summary: paragraphAfterTitle(document),
    flows: [],
    relations: [],
  };

  checkHeadings(
    document,
    { title: true, required: [], optional: ["Flows", "Affects and affected by"] },
    sink,
  );

  for (const flow of readListLines(file, findSection(document, "flows")?.lines, "Flows", sink)) {
    if (!ID.test(flow.name)) {
      sink.report(
        "GR1028",
        `the Flows line names ${JSON.stringify(flow.name)}, which is not a flow id.`,
        flow.at,
      );
      continue;
    }

    readme.flows.push(flow);
  }

  for (const line of logicalLines(findSection(document, "affects and affected by")?.lines ?? [])) {
    const relation = line.text.replace(BULLET, "").trim();

    readme.relations.push({
      text: relation,
      refs: [...relation.matchAll(FLOW_REF_IN_TEXT)].map((match) => match[1] ?? ""),
      at: lineAt(file, line.line),
    });
  }

  return readme;
}

// ── CHANGELOG ──────────────────────────────────────────────────────────────

/** `grimoire/features/<feature>/CHANGELOG.md`. */
export function parseChangelog(
  file: string,
  text: string,
  feature: string,
  sink: FindingSink,
): WrittenChangelog {
  const document = readDocument(file, text, "none", sink);

  new FrontMatterReader(document, sink).onlyKeys([], "a changelog");

  const sections: WrittenChangelogSection[] = [];
  const entries: WrittenChangelogEntry[] = [];
  const seen = new Set<string>();
  let current: WrittenChangelogSection | null = null;

  for (const line of logicalLines(document.body)) {
    const at = lineAt(file, line.line);

    if (/^#[ \t]/.test(line.text)) continue;

    if (line.text.startsWith("#")) {
      const release = RELEASE_HEADING.exec(line.text);
      let section: WrittenChangelogSection | null = null;

      if (UNRELEASED_HEADING.test(line.text)) {
        section = { release: null, date: null, at };
      } else if (release && isDate(release[2] ?? "")) {
        section = { release: release[1] ?? "", date: release[2] ?? "", at };
      }

      if (section === null) {
        sink.report(
          "GR1017",
          `the changelog heading ${JSON.stringify(line.text)} is neither "## Unreleased" nor "## <release> (<yyyy-mm-dd>)".`,
          at,
        );
        continue;
      }

      const key = section.release ?? "";

      if (seen.has(key)) {
        sink.report(
          "GR1017",
          `the changelog heading ${JSON.stringify(line.text)} is written twice; write each section once.`,
          at,
        );
      }

      seen.add(key);
      sections.push(section);
      current = section;
      continue;
    }

    if (!BULLET.test(line.text)) {
      sink.report("GR1015", `the changelog line ${JSON.stringify(line.text)} is not an entry.`, at);
      continue;
    }

    const match = CHANGELOG_ENTRY.exec(line.text);
    const version = match?.[1] ?? "";
    const word = match?.[2] ?? "";

    if (!match || !VERSION.test(version)) {
      sink.report(
        "GR1015",
        `the changelog line ${JSON.stringify(line.text)} is not \`- <version>  <word>  <text>\`.`,
        at,
      );
      continue;
    }

    if (!CHANGE_WORDS.includes(word as ChangeWord)) {
      sink.report(
        "GR1016",
        `the changelog word ${JSON.stringify(word)} is not one of ${CHANGE_WORDS.join(", ")}.`,
        at,
      );
      continue;
    }

    if (current === null) {
      sink.report(
        "GR1015",
        `the changelog entry ${JSON.stringify(line.text)} is not under "## Unreleased" or a release heading.`,
        at,
      );
    }

    const parts = splitEntryText(match[3] ?? "");

    entries.push({
      feature,
      version: { value: version, at },
      word: word as ChangeWord,
      flow: parts.flow,
      criteria: parts.criteria,
      text: parts.text,
      release: current?.release ?? null,
      date: current?.date ?? null,
      at,
    });
  }

  return { file, sections, entries };
}

// ── Flows ──────────────────────────────────────────────────────────────────

function parseSteps(file: string, document: WrittenDocument, sink: FindingSink): WrittenStep[] {
  const steps: WrittenStep[] = [];
  const numbers: { number: number; line: number }[] = [];

  for (const line of logicalLines(findSection(document, "steps")?.lines ?? [])) {
    const at = lineAt(file, line.line);
    const numbered = NUMBERED.exec(line.text);

    if (!numbered) {
      if (BULLET.test(line.text)) {
        sink.report(
          "GR1008",
          `the step ${JSON.stringify(line.text)} is a bullet; number steps \`1. <kind>   <name>\`.`,
          at,
        );
      }

      continue;
    }

    numbers.push({ number: Number(numbered[1]), line: line.line });

    const match = STEP.exec(line.text);

    if (!match) {
      const other = STEP_ANY_TYPE.exec(line.text) ?? STEP_FIRST_WORD.exec(line.text);
      const type = other?.[2] ?? "";

      if (other && !STEP_TYPES.includes(type as StepType)) {
        sink.report(
          "GR1009",
          `the step kind ${JSON.stringify(type)} is not one of: ${STEP_TYPES.join(", ")}.`,
          at,
        );
      } else {
        sink.report(
          "GR1008",
          `the step ${JSON.stringify(line.text)} is not \`<n>. <kind>   <name>\`.`,
          at,
        );
      }

      continue;
    }

    const type = match[2] as StepType;
    let target = (match[3] ?? "").trim();
    let app: string | null = null;
    let route: WrittenStep["route"] = null;
    let affects: WrittenStep["affects"] = null;

    if (type === "page") {
      const scoped = PAGE_TARGET.exec(target);

      if (scoped) {
        target = scoped[1] ?? "";
        app = scoped[2] ?? null;
      }
    }

    if (type === "route") {
      const routeMatch = ROUTE_TARGET.exec(target);

      if (!routeMatch) {
        sink.report(
          "GR1008",
          `the route step ${JSON.stringify(target)} is not \`<METHOD> /path\`.`,
          at,
        );
        continue;
      }

      route = { method: (routeMatch[1] ?? "").toUpperCase(), path: routeMatch[2] ?? "" };
    }

    if (type === "affects") {
      const affectsMatch = AFFECTS_TARGET.exec(target);

      if (!affectsMatch) {
        sink.report(
          "GR1008",
          `the affects step ${JSON.stringify(target)} is not \`<feature>\` or \`<feature>/<flow>\`.`,
          at,
        );
        continue;
      }

      affects = { feature: affectsMatch[1] ?? "", flow: affectsMatch[2] ?? null };
    }

    steps.push({
      index: Number(match[1]),
      type,
      target,
      app,
      route,
      affects,
      note: match[4]?.trim() ?? null,
      at,
    });
  }

  const wrong = numbers.findIndex((entry, position) => entry.number !== position + 1);
  const first = numbers[wrong];

  if (first !== undefined) {
    sink.report(
      "GR1010",
      `step ${first.number} should be step ${wrong + 1}; number the steps 1, 2, 3 in order.`,
      lineAt(file, first.line),
    );
  }

  return steps;
}

function parseCases(file: string, document: WrittenDocument, sink: FindingSink): WrittenCase[] {
  const cases: WrittenCase[] = [];

  for (const line of bulletLines(findSection(document, "cases")?.lines ?? [])) {
    const split = splitListLine(line.text, CASE_QUESTIONS);

    if (split === null) {
      sink.report(
        "GR1011",
        `the case ${JSON.stringify(line.text)} is not \`- <question>   <answer>\`.`,
        lineAt(file, line.line),
      );
      continue;
    }

    const question = normalizeKey(split.name);

    cases.push({
      question,
      fixed: (CASE_QUESTIONS as readonly string[]).includes(question),
      answer: split.text,
      doesNotApply: /^does not apply\b/i.test(split.text),
      at: lineAt(file, line.line),
    });
  }

  return cases;
}

function parseCriteria(
  file: string,
  document: WrittenDocument,
  sink: FindingSink,
): WrittenCriterion[] {
  const criteria: WrittenCriterion[] = [];
  const seen = new Set<number>();

  for (const line of bulletLines(findSection(document, "acceptance criteria")?.lines ?? [])) {
    const at = lineAt(file, line.line);
    const match = CRITERION.exec(line.text);

    if (!match) {
      sink.report(
        "GR1013",
        `the criterion ${JSON.stringify(line.text)} is not \`- AC-<n>   <text>\` or \`- AC-<n> [<app>]   <text>\`.`,
        at,
      );
      continue;
    }

    const number = Number(match[1]);

    if (seen.has(number)) {
      sink.report("GR1014", `AC-${number} is used twice in this flow.`, at);
      continue;
    }

    seen.add(number);
    criteria.push({
      id: `AC-${number}`,
      number,
      app: match[2] ?? null,
      text: (match[3] ?? "").trim(),
      at,
    });
  }

  return criteria;
}

/** `grimoire/features/<feature>/flows/<name>.md`. */
export function parseFlow(
  file: string,
  text: string,
  feature: string,
  name: string,
  sink: FindingSink,
): WrittenFlow {
  const document = readDocument(file, text, "required", sink);
  const fields = new FrontMatterReader(document, sink);

  fields.onlyKeys(["id", "since", "status", "who", "origin"], "flow");

  const id = fields.required("id", checks.id);
  sameAsName(id, name, "flow id", sink);

  const flow: WrittenFlow = {
    file,
    feature,
    id,
    ref: `${feature}/${name}`,
    since: fields.required("since", checks.version),
    status: fields.oneOf("status", STATUSES, FALLBACK_STATUS),
    who: fields.required("who", checks.text),
    origin: fields.optionalOneOf("origin", ORIGINS),
    heading: heading(document),
    steps: [],
    differs: [],
    cases: [],
    notHandled: [],
    unknowns: [],
    criteria: [],
  };

  checkHeadings(
    document,
    {
      title: true,
      required: ["Steps", "Cases", "Acceptance criteria"],
      optional: ["Differs by app", "Not handled"],
    },
    sink,
  );

  flow.steps = parseSteps(file, document, sink);
  flow.differs = readListLines(
    file,
    findSection(document, "differs by app")?.lines,
    "Differs by app",
    sink,
  );
  flow.cases = parseCases(file, document, sink);
  flow.notHandled = readListLines(
    file,
    findSection(document, "not handled")?.lines,
    "Not handled",
    sink,
    CASE_QUESTIONS,
  );
  flow.criteria = parseCriteria(file, document, sink);

  for (const line of document.body) {
    const trimmed = line.text.trim();

    if (!line.fenced && trimmed.startsWith("Unknown:")) {
      flow.unknowns.push({
        text: trimmed.slice("Unknown:".length).trim(),
        at: lineAt(file, line.line),
      });
    }
  }

  const cases = findSection(document, "cases");

  if (cases !== null) {
    const answered = new Set([
      ...flow.cases.map((entry) => entry.question),
      ...flow.notHandled.map((entry) => normalizeKey(entry.name)),
    ]);

    for (const question of CASE_QUESTIONS) {
      if (!answered.has(question)) {
        sink.report(
          "GR1012",
          `the case question "${question}" is answered neither under Cases nor under Not handled.`,
          lineAt(file, cases.line),
        );
      }
    }
  }

  return flow;
}

// ── Version briefs ─────────────────────────────────────────────────────────

/** `grimoire/features/<feature>/versions/v<n>.md`: free text under a title. */
export function parseVersionBrief(
  file: string,
  text: string,
  feature: string,
  major: number,
  sink: FindingSink,
): WrittenVersionBrief {
  const document = readDocument(file, text, "none", sink);

  new FrontMatterReader(document, sink).onlyKeys([], "a version brief");

  return { file, feature, major, heading: heading(document) };
}
