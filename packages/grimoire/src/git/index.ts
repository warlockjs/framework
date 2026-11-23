/**
 * The few git questions the guard and the `changed` screenshot mode ask.
 * Read-only: every call runs `git` with an argument array (never a shell)
 * in the project root, and every path is relative to that root, so a project
 * inside a larger repository works. Failures throw `GrimoireError` with
 * `GR9009`.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

type GitResult = { ok: true; stdout: string } | { ok: false; stderr: string; code: number | string | null };

const MAX_BUFFER = 256 * 1024 * 1024;

/** Run git in `root`; never throws. */
function runGit(root: string, args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-c", "core.quotePath=false", "-C", root, ...args],
      {
        maxBuffer: MAX_BUFFER,
        encoding: "utf8",
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true, stdout });

          return;
        }

        const failure = error as NodeJS.ErrnoException & { code?: number | string };

        resolve({
          ok: false,
          stderr: failure.code === "ENOENT" ? "git is not installed or not on the PATH" : String(stderr),
          code: failure.code ?? null,
        });
      },
    );
  });
}

function gitError(what: string, result: Extract<GitResult, { ok: false }>): GrimoireError {
  const detail = result.stderr.trim().split("\n")[0] ?? "";

  return new GrimoireError(
    "GR9009",
    `Git could not ${what}${detail === "" ? "" : `: ${detail}`}. Run inside a git repository and pass a base that exists (--base origin/main); in CI, fetch the full history.`,
  );
}

async function git(root: string, args: readonly string[], what: string): Promise<string> {
  const result = await runGit(root, args);

  if (!result.ok) throw gitError(what, result);

  return result.stdout;
}

/** The commit a ref names, or `null` when there is none. */
async function commitOf(root: string, ref: string): Promise<string | null> {
  const result = await runGit(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);

  return result.ok ? result.stdout.trim() : null;
}

/** The merge base of `HEAD` and a commit, or the commit itself when the histories share nothing. */
async function mergeBaseWithHead(root: string, commit: string): Promise<string> {
  const result = await runGit(root, ["merge-base", "HEAD", commit]);

  return result.ok && result.stdout.trim() !== "" ? result.stdout.trim() : commit;
}

/**
 * The base to compare with: `base` when given (it must exist), else the
 * default branch (`origin/HEAD`, then `main`, then `master`), else `HEAD`.
 * The answer is the commit where `HEAD` left that ref (their merge base), so
 * a branch that is behind its base does not show the base's own work.
 */
export async function resolveBase(root: string, base?: string): Promise<string> {
  const inside = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);

  if (!inside.ok) throw gitError("read the repository", inside);

  if (base !== undefined && base.trim() !== "") {
    const commit = await commitOf(root, base.trim());

    if (commit === null) {
      throw new GrimoireError(
        "GR9009",
        `Git has no base ${JSON.stringify(base)}. Pass a ref that exists (--base origin/main); in CI, fetch the full history.`,
      );
    }

    return mergeBaseWithHead(root, commit);
  }

  const head = await commitOf(root, "HEAD");

  if (head === null) {
    throw new GrimoireError(
      "GR9009",
      "Git has no commit to compare with yet. Commit once, or pass --base <ref>.",
    );
  }

  const symbolic = await runGit(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const candidates = [symbolic.ok ? symbolic.stdout.trim() : "", "main", "master"].filter(
    (name) => name !== "",
  );

  for (const name of candidates) {
    const commit = await commitOf(root, name);

    if (commit !== null) return mergeBaseWithHead(root, commit);
  }

  return head;
}

function posix(file: string): string {
  return file.split("\\").join("/");
}

/** `@@ -a,b +c,d @@` → the new file's added line numbers. */
function parseDiffLines(diff: string): Map<string, number[]> {
  const added = new Map<string, number[]>();
  let current: number[] | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).replace(/\t.*$/, "");

      if (target === "/dev/null") {
        current = null;
        continue;
      }

      const file = posix(target.startsWith('"') ? unquote(target) : target);

      current = added.get(file) ?? [];
      added.set(file, current);
      continue;
    }

    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);

    if (hunk && current !== null) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);

      for (let offset = 0; offset < count; offset++) current.push(start + offset);
    }
  }

  return added;
}

/** A C-style quoted path from git (`"a\"b"`). */
function unquote(quoted: string): string {
  return quoted
    .slice(1, -1)
    .replace(/\\(["\\])/g, "$1")
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n");
}

/** Line numbers of a whole new file (binary files have none). */
async function allLines(root: string, file: string): Promise<number[]> {
  let content: Buffer;

  try {
    content = await readFile(path.join(root, ...file.split("/")));
  } catch {
    return [];
  }

  if (content.subarray(0, 8000).includes(0)) return [];

  const text = content.toString("utf8");

  if (text === "") return [];

  const count = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

  return Array.from({ length: count }, (_value, index) => index + 1);
}

/**
 * Every file that differs between `base` and the working tree: committed
 * since the base, staged, unstaged and untracked (not ignored) files, sorted
 * by path. `addedLines` come from `git diff --unified=0`; an untracked file
 * counts as added with every line added.
 */
export async function changedFiles(root: string, base: string): Promise<ChangedFile[]> {
  const status = await git(
    root,
    ["diff", "--name-status", "-z", "-M", "--relative", "--no-color", "--no-ext-diff", base, "--"],
    "list the changed files",
  );
  const diff = await git(
    root,
    ["diff", "--unified=0", "-M", "--relative", "--no-prefix", "--no-color", "--no-ext-diff", base, "--"],
    "read the changed lines",
  );
  const untracked = await git(
    root,
    ["ls-files", "-z", "--others", "--exclude-standard"],
    "list the untracked files",
  );
  const lines = parseDiffLines(diff);
  const files = new Map<string, ChangedFile>();
  const fields = status.split("\0");

  for (let index = 0; index < fields.length; index++) {
    const code = fields[index] ?? "";

    if (code === "") continue;

    const letter = code[0];

    if (letter === "R" || letter === "C") {
      const from = posix(fields[index + 1] ?? "");
      const file = posix(fields[index + 2] ?? "");

      index += 2;
      files.set(file, {
        file,
        status: letter === "R" ? "renamed" : "added",
        from: letter === "R" ? from : null,
        addedLines: lines.get(file) ?? [],
      });
      continue;
    }

    const file = posix(fields[index + 1] ?? "");

    index += 1;
    files.set(file, {
      file,
      status: letter === "A" ? "added" : letter === "D" ? "deleted" : "modified",
      from: null,
      addedLines: letter === "D" ? [] : (lines.get(file) ?? []),
    });
  }

  for (const name of untracked.split("\0")) {
    const file = posix(name);

    if (file === "" || files.has(file)) continue;

    files.set(file, { file, status: "added", from: null, addedLines: await allLines(root, file) });
  }

  // An added file that git reports without hunks (the diff of a staged new file) still has every line added.
  for (const entry of files.values()) {
    if (entry.status === "added" && entry.addedLines.length === 0) {
      entry.addedLines = await allLines(root, entry.file);
    }
  }

  return [...files.values()].sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));
}

/** The text of `file` at `ref`, or `null` when it does not exist there. */
export async function showFile(root: string, ref: string, file: string): Promise<string | null> {
  const result = await runGit(root, ["show", `${ref}:./${posix(file).replace(/^\.\//, "")}`]);

  if (result.ok) return result.stdout;

  if ((await commitOf(root, ref)) === null) {
    throw new GrimoireError(
      "GR9009",
      `Git has no ref ${JSON.stringify(ref)}. Pass a ref that exists (--base origin/main); in CI, fetch the full history.`,
    );
  }

  return null;
}

/** The files under `folder` (a project-relative folder) at `ref`, sorted. */
export async function filesAt(root: string, ref: string, folder: string): Promise<string[]> {
  const result = await runGit(root, ["ls-tree", "-r", "-z", "--name-only", ref, "--", `${posix(folder)}/`]);

  if (!result.ok) return [];

  // `ls-tree` prints paths relative to the current folder when it runs inside one.
  return result.stdout
    .split("\0")
    .filter((name) => name !== "")
    .map(posix)
    .sort();
}

/** The commits of a range (`origin/main..HEAD`), oldest first. */
export async function commitsIn(root: string, range: string): Promise<CommitInfo[]> {
  const out = await git(
    root,
    ["log", "--reverse", "--format=%H%x1f%s%x1f%b%x1e", range, "--"],
    `list the commits of ${range}`,
  );

  return out
    .split("\x1e")
    .map((record) => record.replace(/^\n+/, ""))
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [sha = "", subject = "", body = ""] = record.split("\x1f");

      return { sha: sha.trim(), subject: subject.trim(), body: body.trim() };
    });
}
