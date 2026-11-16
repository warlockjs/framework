/**
 * Task files (`grimoire/tasks/open/T-<n>-<slug>.md`,
 * `grimoire/tasks/done/<yyyy-mm>/T-<n>-<slug>.md`) and release files
 * (`grimoire/releases/<release>.md`).
 */
import type { Located } from "../contracts/location";
import {
  COLLECTED_END_MARKER,
  COLLECTED_START_MARKER,
  type ChangeWord,
  type TaskStatus,
  type TaskType,
  type WrittenRelease,
  type WrittenReleaseListed,
  type WrittenTask,
} from "../contracts/written";
import { FLOW_REF, FrontMatterReader, ID, TASK_ID, VERSION, checks } from "./fields";
import { CHANGE_WORDS, splitEntryText } from "./features";
import { BULLET } from "./lists";
import {
  lineAt,
  logicalLines,
  normalizeKey,
  readDocument,
  textAfterTitle,
  type WrittenDocument,
} from "./markdown";
import type { FindingSink } from "./sink";

export const TASK_TYPES: readonly TaskType[] = ["bug", "feature", "decision", "chore"];
export const TASK_STATUSES: readonly TaskStatus[] = [
  "open",
  "waiting for approval",
  "approved",
  "in progress",
  "blocked",
  "done",
  "dropped",
];

const SHIPPED = /^([a-z0-9]+(?:-[a-z0-9]+)*)[ \t]+(\d+\.\d+)$/;
const TASK_FIELD = /^[-*][ \t]+([A-Za-z][A-Za-z0-9 _-]*?):[ \t]+(\S.*)$/;
const LISTED_ENTRY = /^[-*][ \t]+(\S+)[ \t]+(\S+)[ \t]+(\S.*)$/;
const FEATURE_HEADING = /^###[ \t]+(\S.*)$/;

function heading(document: WrittenDocument): Located<string> | null {
  return document.title
    ? { value: document.title.text, at: lineAt(document.file, document.title.line) }
    : null;
}

/** Where a task file sits, from its path. */
export type TaskPlace = {
  folder: "open" | "done";
  month: string | null;
  /** `T-<n>` from the file name, or `null` when the name is wrong. */
  nameId: string | null;
};

/** A task file. */
export function parseTask(
  file: string,
  text: string,
  place: TaskPlace,
  sink: FindingSink,
): WrittenTask {
  const document = readDocument(file, text, "required", sink);
  const fields = new FrontMatterReader(document, sink);

  fields.onlyKeys(["id", "type", "status", "feature", "flow", "apps", "shipped"], "task");

  const id = fields.required("id", (value) =>
    TASK_ID.test(value) ? null : "write a task id as T-<number>",
  );

  if (place.nameId !== null && id.value !== "" && id.value !== place.nameId) {
    sink.report(
      "GR1019",
      `The task id ${JSON.stringify(id.value)} must equal ${JSON.stringify(place.nameId)} from its file name.`,
      id.at,
    );
  }

  const shipped = fields.scalar("shipped", {
    required: place.folder === "done",
    check: (value) =>
      SHIPPED.test(value) ? null : "write it as <feature> <version>, like catalog 2.1",
  });
  const shippedMatch = shipped ? SHIPPED.exec(shipped.value) : null;

  const task: WrittenTask = {
    file,
    folder: place.folder,
    month: place.month,
    id,
    type: fields.oneOf("type", TASK_TYPES, "chore"),
    feature: fields.scalar("feature", { required: false, check: checks.id }),
    flow: fields.scalar("flow", {
      required: false,
      check: (value) =>
        ID.test(value) || FLOW_REF.test(value) ? null : "write a flow id, or <feature>/<flow>",
    }),
    apps: fields.list("apps", { required: false, check: checks.id }),
    status: fields.oneOf("status", TASK_STATUSES, place.folder === "done" ? "done" : "open"),
    shipped:
      shipped && shippedMatch
        ? {
            value: { feature: shippedMatch[1] ?? "", version: shippedMatch[2] ?? "" },
            at: shipped.at,
          }
        : null,
    heading: heading(document),
    fields: [],
    decisionNeeded: null,
  };

  for (const line of logicalLines(document.body)) {
    const match = TASK_FIELD.exec(line.text);

    if (!match) continue;

    const key = (match[1] ?? "").trim();
    const value = (match[2] ?? "").trim();

    task.fields.push({ key, value, at: lineAt(file, line.line) });

    if (task.decisionNeeded === null && normalizeKey(key) === "decision needed")
      task.decisionNeeded = value;
  }

  return task;
}

/** A release file: the agent's brief, then the list Warlock collects between the markers. */
export function parseRelease(
  file: string,
  text: string,
  name: string,
  sink: FindingSink,
): WrittenRelease {
  const document = readDocument(file, text, "required", sink);
  const fields = new FrontMatterReader(document, sink);

  fields.onlyKeys(["release", "date"], "release");

  const release = fields.required("release", checks.name);

  if (release.value !== "" && release.value !== name) {
    sink.report(
      "GR1019",
      `The release ${JSON.stringify(release.value)} must equal the file name ${JSON.stringify(name)}.`,
      release.at,
    );
  }

  const date = fields.required("date", checks.date);

  if (document.title === null) {
    sink.report(
      "GR1006",
      "The file has no `# ` title heading.",
      lineAt(file, document.bodyStartLine),
    );
  }

  const markers = document.body.filter(
    (line) =>
      !line.fenced &&
      (line.text.trim() === COLLECTED_START_MARKER || line.text.trim() === COLLECTED_END_MARKER),
  );
  const starts = markers.filter((line) => line.text.trim() === COLLECTED_START_MARKER);
  const ends = markers.filter((line) => line.text.trim() === COLLECTED_END_MARKER);
  const start = starts[0];
  const end = ends[0];
  let collected: WrittenRelease["collected"] = null;

  if (markers.length > 0) {
    const problem: [string, number] | null =
      start === undefined
        ? ["has an end marker and no start marker", end?.line ?? 1]
        : end === undefined
          ? ["has a start marker and no end marker", start.line]
          : starts.length > 1 || ends.length > 1
            ? ["has more than one collected list", (starts[1] ?? ends[1] ?? start).line]
            : end.line < start.line
              ? ["has the end marker before the start marker", end.line]
              : null;

    if (problem !== null || start === undefined || end === undefined) {
      sink.report(
        "GR1024",
        `The release file ${problem?.[0] ?? "has broken markers"}.`,
        lineAt(file, problem?.[1] ?? 1),
      );
    } else {
      collected = {
        start: lineAt(file, start.line),
        end: lineAt(file, end.line),
        entries: readCollected(
          file,
          document.body.filter((line) => line.line > start.line && line.line < end.line),
          sink,
        ),
      };
    }
  }

  return {
    file,
    release,
    date,
    heading: heading(document),
    brief: textAfterTitle(document, markers[0]?.line),
    collected,
  };
}

function readCollected(
  file: string,
  lines: WrittenDocument["body"],
  sink: FindingSink,
): WrittenReleaseListed[] {
  const entries: WrittenReleaseListed[] = [];
  let feature: string | null = null;

  for (const line of logicalLines(lines)) {
    const at = lineAt(file, line.line);
    const featureHeading = FEATURE_HEADING.exec(line.text);

    if (featureHeading) {
      feature = (featureHeading[1] ?? "").trim();
      continue;
    }

    if (/^##[ \t]+changes$/i.test(line.text) || line.text === "No feature changes.") continue;

    const match = BULLET.test(line.text) ? LISTED_ENTRY.exec(line.text) : null;
    const version = match?.[1] ?? "";
    const word = match?.[2] ?? "";

    if (!match || !VERSION.test(version) || feature === null) {
      sink.report(
        "GR1015",
        feature === null && match
          ? `The collected entry ${JSON.stringify(line.text)} is not under a "### <feature>" heading.`
          : `The collected line ${JSON.stringify(line.text)} is not an entry \`- <version> <word> <text>\`.`,
        at,
      );
      continue;
    }

    if (!CHANGE_WORDS.includes(word as ChangeWord)) {
      sink.report(
        "GR1016",
        `The collected word ${JSON.stringify(word)} is not one of ${CHANGE_WORDS.join(", ")}.`,
        at,
      );
      continue;
    }

    const parts = splitEntryText(match[3] ?? "");

    entries.push({ feature, version, word: word as ChangeWord, ...parts, at });
  }

  return entries;
}
