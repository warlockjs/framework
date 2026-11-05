import { WorkspaceEditError } from "../errors";
import type { MultiEditOperation, WorkspaceEditLineEndings } from "../contracts";
import {
  describeMiss,
  detectEol,
  locateEdit,
  withEol,
  type WorkspaceEditMatching,
  type WorkspaceEditMatchTier,
} from "./match";

/** What one applied replacement did. */
export interface AppliedReplacement {
  content: string;
  replacements: number;
  /** The tier that matched, set only when it was a fuzzy one. */
  matchTier?: Exclude<WorkspaceEditMatchTier, "exact">;
}

/** The edit-policy settings {@link applyReplacement} honours. */
export interface AppliedReplacementOptions {
  matching: WorkspaceEditMatching;
  /** Most lines a miss hint shows; `0` for none. */
  missHintLines: number;
  /** Cap on a miss hint's size in bytes (the read policy's `maxBytes`). */
  hintMaxBytes?: number;
  lineEndings: WorkspaceEditLineEndings;
}

/**
 * Apply one replacement to `content` under the edit rules: `oldString` must
 * be found (see {@link WorkspaceEditMatching}), and exactly once unless
 * `replaceAll` — a fuzzy match must always be unique, so a loose match never
 * rewrites several places at once.
 */
export function applyReplacement(
  content: string,
  edit: MultiEditOperation,
  inputPath: string,
  shownPath: string,
  options: AppliedReplacementOptions,
  editIndex?: number,
): AppliedReplacement {
  const { matching } = options;
  const located = edit.oldString === "" ? null : locateEdit(content, edit.oldString, matching);
  const count = located?.ranges.length ?? 0;
  const which = editIndex === undefined ? "" : `Edit ${editIndex + 1}: `;
  const nothingApplied = editIndex === undefined ? "" : " None of the edits were applied.";
  const indexOption = editIndex === undefined ? {} : { editIndex };

  if (located === null || count === 0) {
    let hint = describeMiss(content, edit.oldString, edit.newString, options.missHintLines);

    if (hint !== undefined && options.hintMaxBytes !== undefined) {
      hint = Buffer.byteLength(hint, "utf8") > options.hintMaxBytes ? undefined : hint;
    }

    throw new WorkspaceEditError(
      `${which}The text to replace was not found in "${inputPath}".` +
        (hint === undefined ? "" : ` ${hint}`) +
        nothingApplied,
      {
        type: "not-found",
        path: shownPath,
        matches: 0,
        ...(hint !== undefined ? { hint } : {}),
        ...indexOption,
      },
    );
  }

  const fuzzy = located.tier !== "exact";

  if (count > 1 && (!edit.replaceAll || fuzzy)) {
    const advice = fuzzy
      ? "include more surrounding context."
      : "pass replaceAll or include more surrounding context.";

    throw new WorkspaceEditError(
      `${which}The text to replace is not unique in "${inputPath}" (${count} matches${
        fuzzy && located.viaView ? ", found by loose matching" : ""
      }); ${advice}${nothingApplied}`,
      { type: "not-unique", path: shownPath, matches: count, ...indexOption },
    );
  }

  const eol =
    options.lineEndings === "lf"
      ? "\n"
      : options.lineEndings === "crlf"
        ? "\r\n"
        : matching === "tiered"
          ? detectEol(content)
          : undefined;
  const replacement = eol === undefined ? edit.newString : withEol(edit.newString, eol);
  const ranges = edit.replaceAll ? located.ranges : located.ranges.slice(0, 1);
  let out = "";
  let cursor = 0;

  for (const range of ranges) {
    out += content.slice(cursor, range.start) + replacement;
    cursor = range.end;
  }

  out += content.slice(cursor);

  return {
    content: out,
    replacements: ranges.length,
    ...(fuzzy ? { matchTier: located.tier as "unicode" | "whitespace" } : {}),
  };
}
