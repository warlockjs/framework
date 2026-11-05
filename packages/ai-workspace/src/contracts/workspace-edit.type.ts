import type { WorkspaceEditMatching, WorkspaceEditMatchTier } from "../edit/match";

export type { WorkspaceEditMatching, WorkspaceEditMatchTier };

/** Line endings of the text an edit writes. */
export type WorkspaceEditLineEndings = "preserve" | "lf" | "crlf";

/**
 * Edit sub-policy for `edit_file` / `multi_edit` and their direct methods.
 */
export interface WorkspaceEditPolicy {
  /**
   * How `oldString` is found. `"tiered"` (default) tries the exact text first,
   * then the text with line endings normalised, with look-alike Unicode
   * punctuation folded, and finally line by line ignoring trailing
   * whitespace; a loose match must be unique even with `replaceAll`.
   * `"exact"` accepts only the text byte for byte.
   */
  matching?: WorkspaceEditMatching;
  /**
   * Most lines of nearby file text a "not found" error shows to help the next
   * attempt. Default `12`; `0` turns hints off. A hint never exceeds
   * `read.maxBytes`, and a file the jail refuses never gets one.
   */
  missHintLines?: number;
  /**
   * Line endings of replacement text. `"preserve"` (default) uses the file's
   * dominant ending; `"lf"` / `"crlf"` force one.
   */
  lineEndings?: WorkspaceEditLineEndings;
}

/** Which tool changed files, as reported to {@link WorkspaceHooks.afterEdit}. */
export type WorkspaceEditTool = "write_file" | "edit_file" | "multi_edit" | "apply_patch";

/** What {@link WorkspaceHooks.afterEdit} is told about a successful write. */
export interface WorkspaceAfterEditEvent {
  /** Workspace-relative paths written by the call (deleted files are not listed). */
  paths: readonly string[];
  /** The tool that wrote them. */
  tool: WorkspaceEditTool;
  /** Cancellation of the agent run, when the caller has one. */
  signal?: AbortSignal;
}

/**
 * Host callbacks around workspace changes.
 *
 * @example
 * hooks: {
 *   afterEdit: async ({ paths }) => await typecheck(paths),
 * }
 */
export interface WorkspaceHooks {
  /**
   * Runs once per call after `write_file`, `edit_file`, `multi_edit` or
   * `apply_patch` has written files (not on a patch `dryRun`). Return text
   * such as compiler or linter output and it comes back on the result as
   * `diagnostics`, between `[diagnostics]` and `[/diagnostics]` lines, so the
   * model sees the effect of its change at once. A throw, or no answer within
   * `afterEditTimeoutMs`, reports "diagnostics unavailable" and never fails
   * the edit.
   */
  afterEdit?: (event: WorkspaceAfterEditEvent) => Promise<string | void> | string | void;
  /** Longest diagnostics text kept; more is cut with a marker. Default `4000`. */
  afterEditMaxChars?: number;
  /** How long to wait for `afterEdit`, in ms. Default `10000`. */
  afterEditTimeoutMs?: number;
}
