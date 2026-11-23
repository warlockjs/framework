/**
 * The few git questions the guard and the `changed` screenshot mode ask.
 * Read-only: every call runs `git` with arguments (never a shell) in the
 * project root. Contract stub of the 5.64 shared contracts; the guard
 * implementation replaces the bodies. Failures throw `GrimoireError` with
 * `GR9009`.
 */
import { GrimoireError } from "../codes";

/** How a file changed between the base and the working tree. */
export type ChangedFileStatus = "added" | "modified" | "deleted" | "renamed";

/** One changed file, project-relative POSIX paths. */
export type ChangedFile = {
  file: string;
  status: ChangedFileStatus;
  /** The path at the base for a rename, else `null`. */
  from: string | null;
  /** Line numbers (1-based, in the new file) the change adds; empty for a deleted file. */
  addedLines: number[];
};

/** One commit of a range. */
export type CommitInfo = { sha: string; subject: string; body: string };

/**
 * The base ref to compare with: `base` when given (it must exist), else the
 * merge base of `HEAD` with the default branch (`origin/HEAD`, then `main`,
 * then `master`), else `HEAD`.
 */
export async function resolveBase(root: string, base?: string): Promise<string> {
  void root;
  void base;

  throw new GrimoireError("GR9009", "Git questions are not built yet.");
}

/**
 * Every file that differs between `base` and the working tree: committed
 * since the base, staged, unstaged and untracked (not ignored) files.
 */
export async function changedFiles(root: string, base: string): Promise<ChangedFile[]> {
  void root;
  void base;

  throw new GrimoireError("GR9009", "Git questions are not built yet.");
}

/** The text of `file` at `ref`, or `null` when it does not exist there. */
export async function showFile(root: string, ref: string, file: string): Promise<string | null> {
  void root;
  void ref;
  void file;

  throw new GrimoireError("GR9009", "Git questions are not built yet.");
}

/** The commits of a range (`origin/main..HEAD`), oldest first. */
export async function commitsIn(root: string, range: string): Promise<CommitInfo[]> {
  void root;
  void range;

  throw new GrimoireError("GR9009", "Git questions are not built yet.");
}
