/** Which part of an oversized output is returned inline. */
export type WorkspaceOutputKeep = "head" | "tail" | "head+tail";

/**
 * Output sub-policy. With a `spillDir`, output too large to return whole
 * (`run_shell`, `shell_output`, `grep`, `glob`, and `read_file` when
 * `read.maxBytes` cuts the window) is written in full to a file there, and the
 * result carries the part selected by `keep` plus a marker
 * `[showing lines 1-N of TOTAL; full output saved to FILE]`. The model can open
 * the file with `read_file` (the spill directory is the one place outside the
 * jail a read may open) or search it. Without a `spillDir`, output is cut at
 * `shell.maxOutputBytes` / `read.maxBytes` and nothing is saved.
 *
 * Spill files are named `spill-<time>-<random>-<label>.txt`; cleanup removes
 * only files of that name.
 */
export interface WorkspaceOutputPolicy {
  /** Most lines returned inline from one output. Default `2000`. */
  maxLines?: number;
  /** Most bytes returned inline from one output (the marker not counted). Default `51200`. */
  maxBytes?: number;
  /**
   * Directory spill files go to; opting in is what turns spilling on. A
   * relative path resolves against `cwd`.
   */
  spillDir?: string;
  /**
   * How long a spill file is kept, in ms. Older ones are removed when a
   * workspace is created, when a new one is written and on `dispose()`. `0`
   * removes the files this workspace wrote when it is disposed. Default 7 days.
   */
  retentionMs?: number;
  /**
   * What stays inline. Default `"head+tail"` for shell output (the start and
   * the end both matter) and `"head"` for `grep`, `glob` and `read_file`.
   */
  keep?: WorkspaceOutputKeep;
}

/**
 * What a truncated output left out. Sits beside the boolean `truncated` on a
 * result.
 */
export interface WorkspaceTruncation {
  /** What the result carries. */
  shown: { lines: number };
  /** The complete output. */
  total: { lines: number; bytes: number };
  /** Absolute path of the file holding the complete output, when one was saved. */
  path?: string;
}
