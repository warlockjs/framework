/**
 * The agent-written files under `grimoire/`, as the parser (`parseGrimoire`)
 * returns them. Warlock reads these files and never edits them, except the
 * collected list between the markers of a release file.
 *
 * Every value that a check may point at carries its location. Absent
 * optional values are `null`, never `undefined`.
 *
 * The grammar of each file is fixed (see the docs page "Written files"):
 * front matter between `---` lines (`key: value`, inline lists `[a, b]` or
 * `- item` lines under the key), then Markdown with fixed headings.
 */
import type { Located, SourceLocation } from "./location";

/** Status of a feature or a flow. */
export type WrittenStatus = "proposed" | "building" | "shipped" | "retired";

/** Whether the description was written from the code (`inferred`) or confirmed by the owner. */
export type WrittenOrigin = "inferred" | "confirmed";

/** A feature version: `<whole>.<decimal>` (`2.1`). */
export type FeatureVersion = string;

/** A flow reference: `<feature>/<flow>`. */
export type FlowRef = string;

/** A criterion id: `AC-<n>`. */
export type CriterionId = string;

/** One `- name   text` line of a list section. */
export type WrittenListLine = {
  /** The first word or phrase (a flow id, an app id, a condition name, a question). */
  name: string;
  /** The rest of the line, continuation lines joined with a space. */
  text: string;
  at: SourceLocation;
};

// ── Features ───────────────────────────────────────────────────────────────

/** `grimoire/features/<id>/README.md`. */
export type WrittenFeatureReadme = {
  file: string;
  /** Front matter `id`; must equal the folder name. */
  id: Located<string>;
  title: Located<string>;
  status: Located<WrittenStatus>;
  version: Located<FeatureVersion>;
  /** `yyyy-mm-dd`. */
  updated: Located<string>;
  /** App ids under `grimoire/apps/`. */
  apps: Located<string>[];
  /** Project-relative folders whose files the feature owns. */
  folders: Located<string>[];
  origin: Located<WrittenOrigin> | null;
  /** The `# Heading`. */
  heading: Located<string> | null;
  /** The paragraph under the heading, or `null`. */
  summary: string | null;
  /** `## Flows`: `- <flow-id>   <what it does>`. */
  flows: WrittenListLine[];
  /** `## Affects and affected by`: free lines; references `<feature>/<flow>` are read from them. */
  relations: { text: string; refs: FlowRef[]; at: SourceLocation }[];
};

/** A changed-word of a changelog entry. */
export type ChangeWord = "added" | "changed" | "fixed" | "removed";

/**
 * One changelog entry:
 * `- <version>  <word>  [<flow>: ]<text>[ (AC-n[, AC-m])]`, continuation
 * lines indented.
 */
export type WrittenChangelogEntry = {
  feature: string;
  version: Located<FeatureVersion>;
  word: ChangeWord;
  /** The flow id named before `:`, or `null`. */
  flow: string | null;
  /** Criteria named in the trailing parentheses. */
  criteria: CriterionId[];
  /** The text without the flow prefix and the criteria. */
  text: string;
  /** `null` while under `## Unreleased`; the section's release once the agent moved it. */
  release: string | null;
  /** `yyyy-mm-dd` of the release section, or `null`. */
  date: string | null;
  at: SourceLocation;
};

/**
 * A changelog section: `## Unreleased`, or `## <release> (<yyyy-mm-dd>)`
 * for a release the agent stamped.
 */
export type WrittenChangelogSection = {
  release: string | null;
  date: string | null;
  at: SourceLocation;
};

/** `grimoire/features/<id>/CHANGELOG.md`, newest first. */
export type WrittenChangelog = {
  file: string;
  sections: WrittenChangelogSection[];
  entries: WrittenChangelogEntry[];
};

/** Flow step kinds. `affects` names an effect on another feature. */
export type StepType =
  | "page"
  | "route"
  | "mail"
  | "notification"
  | "job"
  | "event"
  | "outside service"
  | "affects";

/** One `<n>. <kind>   <target>[ — note]` line of `## Steps`. */
export type WrittenStep = {
  /** The number written before the dot. */
  index: number;
  type: StepType;
  /** The name as written (`POST /wishlist`, `/products/:id`, `order-confirmation`, `catalog/stock`). */
  target: string;
  /** For a route step: the uppercase method and the path. */
  route: { method: string; path: string } | null;
  /** For an affects step: the feature and, when given, the flow. */
  affects: { feature: string; flow: string | null } | null;
  /** Text after ` — ` (or ` -- `), or `null`. */
  note: string | null;
  at: SourceLocation;
};

/** The fixed case questions every flow answers (in `## Cases` or `## Not handled`). */
export const CASE_QUESTIONS = [
  "invalid input",
  "not allowed",
  "not found",
  "duplicate",
  "limits",
  "expiry",
  "double submit",
  "outside service down",
] as const;

/** One fixed case question. */
export type CaseQuestion = (typeof CASE_QUESTIONS)[number];

/** One `- <question>   <answer>` line of `## Cases`. */
export type WrittenCase = {
  /** The question, lower-case (`double submit`), or the owner's own case label. */
  question: string;
  /** Whether `question` is one of {@link CASE_QUESTIONS}. */
  fixed: boolean;
  answer: string;
  /** The answer starts with `does not apply`. */
  doesNotApply: boolean;
  at: SourceLocation;
};

/** One `- AC-<n>[ [app-id]]   <text>` line of `## Acceptance criteria`. */
export type WrittenCriterion = {
  id: CriterionId;
  number: number;
  /** The app the criterion is scoped to, or `null` for every app. */
  app: string | null;
  text: string;
  at: SourceLocation;
};

/** `grimoire/features/<feature>/flows/<id>.md`. */
export type WrittenFlow = {
  file: string;
  feature: string;
  /** Front matter `id`; must equal the file name without `.md`. */
  id: Located<string>;
  /** `<feature>/<id>`. */
  ref: FlowRef;
  /** The feature version that introduced the flow. */
  since: Located<FeatureVersion>;
  status: Located<WrittenStatus>;
  /** Who walks the flow (`customer`, `guest`, `admin`, `system`). Free text. */
  who: Located<string>;
  origin: Located<WrittenOrigin> | null;
  heading: Located<string> | null;
  steps: WrittenStep[];
  /** `## Differs by app`: `- <app-id>   <what differs>`. */
  differs: WrittenListLine[];
  cases: WrittenCase[];
  /** `## Not handled`: questions the code does not handle yet. */
  notHandled: WrittenListLine[];
  /** Every line starting with `Unknown:` anywhere in the flow. */
  unknowns: { text: string; at: SourceLocation }[];
  criteria: WrittenCriterion[];
};

/** `grimoire/features/<feature>/versions/v<n>.md`: the brief before a whole-number version. */
export type WrittenVersionBrief = {
  file: string;
  feature: string;
  /** The whole number from the file name (`3` for `v3.md`). */
  major: number;
  heading: Located<string> | null;
};

/** One feature folder. */
export type WrittenFeature = {
  id: string;
  /** `grimoire/features/<id>`. */
  dir: string;
  /** `null` when the folder has no README (a structure error). */
  readme: WrittenFeatureReadme | null;
  changelog: WrittenChangelog | null;
  flows: WrittenFlow[];
  versions: WrittenVersionBrief[];
};

// ── Apps ───────────────────────────────────────────────────────────────────

/** Who sees a block: `everyone`, or condition names of the app. */
export type WrittenWho = {
  everyone: boolean;
  conditions: string[];
};

/** One `Changes with` item: `<condition>: <text>`, or free text with no condition. */
export type WrittenChangesWith = {
  condition: string | null;
  text: string;
};

/** One row of a `## Blocks` table: `| Block | Flow | Who sees it | Changes with |`. */
export type WrittenBlockRow = {
  block: string;
  /** `<feature>/<flow>`, or `null` for `—`. */
  flow: FlowRef | null;
  who: WrittenWho;
  /** Empty for `—`. Items are separated by `;`. */
  changesWith: WrittenChangesWith[];
  at: SourceLocation;
};

/** `grimoire/apps/<app>/layouts/<id>.md`. */
export type WrittenLayout = {
  file: string;
  app: string;
  /** The file name without `.md`. */
  id: string;
  heading: Located<string> | null;
  blocks: WrittenBlockRow[];
};

/** `grimoire/apps/<app>/pages/<page>/blocks/<id>.md`. */
export type WrittenBlockFile = {
  file: string;
  app: string;
  /** The page or screen folder name. */
  page: string;
  id: string;
  flow: Located<FlowRef> | null;
  heading: Located<string> | null;
  /** `- <key>   <value>` lines. */
  details: WrittenListLine[];
};

/** One `- <kind>   <name>` line of `## Also reached from`. */
export type WrittenEntryPoint = {
  /** `mail`, `notification`, `page`, `screen`, `outside service`, or another word. */
  type: string;
  name: string;
  at: SourceLocation;
};

/**
 * `grimoire/apps/<app>/pages/<id>/README.md` (a site page) or
 * `grimoire/apps/<app>/screens/<id>/README.md` (a mobile screen).
 */
export type WrittenPage = {
  file: string;
  app: string;
  type: "page" | "screen";
  /** The folder name. */
  id: string;
  /** Front matter `route`: the page's route path, or a screen's file-based route. */
  route: Located<string> | null;
  /** Front matter `screen`: the screen name used by code-defined navigation. */
  screen: Located<string> | null;
  /** Front matter `layout`: a file in the app's `layouts/`. */
  layout: Located<string> | null;
  heading: Located<string> | null;
  /** The paragraph under the heading, or `null`. */
  purpose: string | null;
  blocks: WrittenBlockRow[];
  alsoReachedFrom: WrittenEntryPoint[];
  blockFiles: WrittenBlockFile[];
};

/** `grimoire/apps/<id>/README.md` and everything under that folder. */
export type WrittenApp = {
  /** `grimoire/apps/<id>`. */
  dir: string;
  /** `README.md`, or `null` when missing (a structure error). */
  file: string | null;
  /** Front matter `id`; must equal the folder name. */
  id: Located<string>;
  type: Located<"site" | "mobile">;
  /** Project-relative root of the site or mobile app (`src/web/$sites/client`, `mobile`). */
  root: Located<string>;
  heading: Located<string> | null;
  /** `## Conditions`: `- <name>   <meaning>`. */
  conditions: WrittenListLine[];
  layouts: WrittenLayout[];
  pages: WrittenPage[];
  screens: WrittenPage[];
};

// ── Tasks ──────────────────────────────────────────────────────────────────

export type TaskType = "bug" | "feature" | "decision" | "chore";

export type TaskStatus =
  | "open"
  | "waiting for approval"
  | "approved"
  | "in progress"
  | "blocked"
  | "done"
  | "dropped";

/**
 * `grimoire/tasks/open/T-<n>-<slug>.md` or
 * `grimoire/tasks/done/<yyyy-mm>/T-<n>-<slug>.md`.
 */
export type WrittenTask = {
  file: string;
  /** Which folder holds it. */
  folder: "open" | "done";
  /** `yyyy-mm` of the done folder, or `null` for open tasks. */
  month: string | null;
  /** `T-<n>`. */
  id: Located<string>;
  type: Located<TaskType>;
  feature: Located<string> | null;
  /** Flow id within `feature`, or a full `<feature>/<flow>`; stored as written. */
  flow: Located<string> | null;
  apps: Located<string>[];
  status: Located<TaskStatus>;
  /** `shipped: <feature> <version>`, once done. */
  shipped: Located<{ feature: string; version: FeatureVersion }> | null;
  heading: Located<string> | null;
  /** `- <Key>: <value>` lines of the body (`Asked by`, `Why`, `Brief`, `Decision needed`, …). */
  fields: { key: string; value: string; at: SourceLocation }[];
  /** The `Decision needed` value, or `null`. */
  decisionNeeded: string | null;
};

// ── Releases ───────────────────────────────────────────────────────────────

/** Markers around the list Warlock writes into a release file. */
export const COLLECTED_START_MARKER = "<!-- grimoire:collected:start -->";
export const COLLECTED_END_MARKER = "<!-- grimoire:collected:end -->";

/** One line of a release file's collected list, read back. */
export type WrittenReleaseListed = {
  feature: string;
  version: FeatureVersion;
  word: ChangeWord;
  flow: string | null;
  criteria: CriterionId[];
  text: string;
  at: SourceLocation;
};

/** `grimoire/releases/<release>.md`. */
export type WrittenRelease = {
  file: string;
  /** Front matter `release`; must equal the file name without `.md`. */
  release: Located<string>;
  /** `yyyy-mm-dd`. */
  date: Located<string>;
  heading: Located<string> | null;
  /** The agent's brief: the text between the heading and the collected list. */
  brief: string;
  /** The list between the markers; `null` when the release command has not run yet. */
  collected: { start: SourceLocation; end: SourceLocation; entries: WrittenReleaseListed[] } | null;
};

// ── Everything ─────────────────────────────────────────────────────────────

/** Every written file of a project, parsed. */
export type WrittenGrimoire = {
  /** Absolute project root. */
  root: string;
  /** `false` when the project has no `grimoire/` folder (book-only mode). */
  exists: boolean;
  features: WrittenFeature[];
  apps: WrittenApp[];
  tasks: WrittenTask[];
  releases: WrittenRelease[];
  /**
   * sha256 over the path and content of every written file, in path order.
   * The book manifest stores it to know when ownership and book maps change.
   */
  hash: string;
};
