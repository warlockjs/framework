/**
 * What the parser and the check report. One shape for both: a structure
 * error from the parser is a finding with a `GR1xxx` code.
 *
 * Codes are `GR` + four digits; the first digit is the area (see
 * `GRIMOIRE_CODES` in `src/codes/codes.ts`, the only list of codes).
 */
import type { SourceLocation } from "./location";

/** `error` fails `warlock grimoire check` (exit 1); `warning` is reported and does not. */
export type GrimoireSeverity = "error" | "warning";

/** The area of a code, matching its first digit. */
export type GrimoireCodeArea =
  | "structure" // GR1xxx  a written file does not follow its fixed structure
  | "links" // GR2xxx  a written name points at something that does not exist
  | "files" // GR3xxx  source files: headers, owners, unreached files
  | "tests" // GR4xxx  criteria, `@proves` lines and test results
  | "apps" // GR5xxx  sites, mobile apps, pages, screens and blocks
  | "changelog" // GR6xxx  feature versions, changelogs and releases
  | "tasks" // GR7xxx  task files
  | "book" // GR8xxx  building the book from the adapter
  | "usage"; // GR9xxx  a command or query was asked something it cannot answer

/** One entry of the code catalog. Same fields as core's error-code entries, plus a default severity. */
export type GrimoireCodeDefinition = {
  /** `GR` + four digits. */
  readonly code: string;
  readonly area: GrimoireCodeArea;
  /** The severity a finding gets unless the rule says otherwise. */
  readonly severity: GrimoireSeverity;
  /** One-line name of the problem. */
  readonly title: string;
  /** One-line "what to do". */
  readonly fix: string;
  /** Slug of the skill that explains the fix (`packages/grimoire/skills/<slug>/SKILL.md`). */
  readonly skill: string;
};

/** One problem found in the written files, the source files or the book. */
export type GrimoireFinding = {
  /** Stable code, `warlock explain <code>` describes it. */
  code: string;
  severity: GrimoireSeverity;
  /** What is wrong, naming the value (`route step "POST /wishlist" matches no route`). */
  message: string;
  /** Where to fix it, or `null` when the finding has no single place. */
  at: SourceLocation | null;
  /**
   * `true` when the finding concerns a feature or flow whose status is
   * `proposed`: the code does not exist yet, so the finding is shown as
   * expected and never fails the check.
   */
  expected: boolean;
  /** The feature, flow (`<feature>/<flow>`), app and task the finding is about, when any. */
  subject: {
    feature: string | null;
    flow: string | null;
    app: string | null;
    task: string | null;
    file: string | null;
  };
  /** One line on what to do, from the catalog. */
  hint: string;
};

/** What a rule passes to `createFinding()`; the rest comes from the catalog. */
export type GrimoireFindingInput = {
  code: string;
  message: string;
  at?: SourceLocation | null;
  severity?: GrimoireSeverity;
  feature?: string | null;
  flow?: string | null;
  app?: string | null;
  task?: string | null;
  file?: string | null;
};

/** How fresh the route facts were when a report was made. */
export type RouteFreshness = "fresh" | "cached" | "stale" | "missing";

/** The result of `checkGrimoire()`, printed by `warlock grimoire check --json`. */
export type GrimoireCheckReport = {
  schemaVersion: 1;
  /** Absolute project root. */
  root: string;
  /** Unexpected findings first, expected ones last; within each, errors then warnings, then by file and line. */
  findings: GrimoireFinding[];
  counts: { errors: number; warnings: number; expected: number };
  /** `true` when no finding is an unexpected error. The command exits 1 otherwise. */
  ok: boolean;
  /** Route steps are checked against cached facts when `stale`, and skipped when `missing`. */
  routes: RouteFreshness;
};
