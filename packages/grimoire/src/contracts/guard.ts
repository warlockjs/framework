/**
 * The guard: a change (the git diff against a base) checked against its task.
 * `GuardInput` is everything the pure rules read, gathered by the command
 * from git, the working tree and the snapshot; `GuardReport` is what
 * `warlock grimoire guard --json` prints.
 */
import type { ChangedFile, CommitInfo } from "../git";
import type { Ownership } from "./bookmap";
import type { GrimoireFinding } from "./findings";
import type { GrimoireSettings } from "./settings";
import type { DriftItem } from "./shots";
import type { ProofLine } from "./test-results";
import type { FlowRef, WrittenGrimoire } from "./written";

export type { ChangedFile, ChangedFileStatus, CommitInfo } from "../git";

/**
 * One `Removes:` entry of a task: what the task may delete.
 * `catalog` (a feature), `catalog/new-arrivals` (a flow),
 * `catalog/new-arrivals AC-2` (a criterion) or
 * `catalog/new-arrivals case duplicate` (a case).
 */
export type RemoveEntry = {
  feature: string;
  flow: string | null;
  /** `AC-<n>`, upper-case, or `null`. */
  criterion: string | null;
  /** The case question, lower-case, or `null`. */
  case: string | null;
  /** The entry as written. */
  text: string;
};

/** What a task allows, read from its front matter and its `- Key: value` body lines. */
export type TaskScope = {
  /** `T-<n>`. */
  id: string;
  /** The task file, project-relative. */
  file: string;
  /** The task's own `feature` and `flow` (`<feature>/<flow>`), or `null`. */
  feature: string | null;
  flow: FlowRef | null;
  /** The feature, plus the `Features:` entries (a `<feature>/<flow>` entry names a flow). */
  features: string[];
  /** `Files:` globs. */
  files: string[];
  /** `Locked:` globs: test files no one may edit. */
  locked: string[];
  /** `Touches:` names: the protected areas the task may change (lower-case). */
  touches: string[];
  removes: RemoveEntry[];
};

/** The approved public API, `grimoire/approved/api.json`. */
export type ApiSnapshot = {
  schemaVersion: 1;
  /** ISO time of the approval. */
  approvedAt: string;
  /** Sorted `METHOD /path` lines, with ` [auth]` appended when the route needs a signed-in user. */
  routes: string[];
};

/** The text of a changed file at the base and now; `null` when it does not exist there. */
export type GuardFileText = { base: string | null; current: string | null };

/** Everything the pure guard rules read. No git and no files are read inside them. */
export type GuardInput = {
  /** The task(s) the change is checked against, merged; `null` when none was found (`GR9008`). */
  scope: TaskScope | null;
  changed: ChangedFile[];
  /** Text of the changed code, test and manifest files, by project-relative path (the new path of a rename). */
  texts: Record<string, GuardFileText>;
  ownership: Ownership;
  /** Flow ref → every file its steps reach. */
  flowFiles: Record<FlowRef, string[]>;
  /** The `@proves` lines of the working tree. */
  proofs: ProofLine[];
  /** The written files at the base (only their features), or `null` when none changed. */
  baseWritten: WrittenGrimoire | null;
  written: WrittenGrimoire;
  settings: GrimoireSettings;
  /** Test files the book knows. */
  testFiles: string[];
  api: { approved: ApiSnapshot | null; routes: string[] | null };
  /** The commits to check, or `null` when `--commits` was not given. */
  commits: CommitInfo[] | null;
  /** Every task id the project has (`T-12`). */
  taskIds: string[];
};

/** What `warlock grimoire guard --json` prints. */
export type GuardReport = {
  schemaVersion: 1;
  /** The task id(s) checked, joined by a comma, or `null` when none was found. */
  task: string | null;
  /** The commit the change was compared with. */
  base: string;
  changed: ChangedFile[];
  findings: GrimoireFinding[];
  /** Changes since the approved baseline that nobody approved yet. They never fail the guard. */
  notApproved: DriftItem[];
  counts: { errors: number; warnings: number; expected: number };
  ok: boolean;
};
