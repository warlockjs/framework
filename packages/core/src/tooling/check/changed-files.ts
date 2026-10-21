import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createProblem, type ToolingProblem } from "../problem";

/** The result of one git invocation. */
export type GitResult = { code: number; stdout: string; stderr: string };

/** Runs `git <args>` in `cwd`. Injectable so tests need no repository. */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<GitResult>;

/** The default {@link GitRunner}: the `git` on PATH. */
export const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile(
      "git",
      [...args],
      { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 127;

        resolve({ code, stdout, stderr: stderr || (error?.message ?? "") });
      },
    );
  });

/** Files `warlock check --changed` considers: JavaScript and TypeScript sources. */
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/i;

function lines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function gitProblem(message: string): ToolingProblem {
  return createProblem({ code: "WL8006", source: "environment", message });
}

/**
 * The source files changed in the working tree — tracked changes against
 * `base` (or HEAD) plus untracked files — relative to `cwd`, existing only.
 *
 * With `base`, the comparison point is `git merge-base <base> HEAD`, so a
 * branch is compared with where it left `base` rather than with `base`'s tip.
 * A git failure is a `WL8006` environment problem.
 */
export async function listChangedFiles(options: {
  cwd: string;
  base?: string;
  git?: GitRunner;
  /** Keep deleted paths as seeds for reverse dependency selection. */
  includeDeleted?: boolean;
}): Promise<{ files: string[] } | { problem: ToolingProblem }> {
  const git = options.git ?? runGit;
  let ref = "HEAD";

  if (options.base) {
    const mergeBase = await git(["merge-base", options.base, "HEAD"], options.cwd);

    if (mergeBase.code !== 0) {
      return {
        problem: gitProblem(
          `git merge-base ${options.base} HEAD failed: ${mergeBase.stderr.trim() || `exit ${mergeBase.code}`}`,
        ),
      };
    }

    ref = mergeBase.stdout.trim();
  }

  // `--relative` makes the paths relative to cwd and limits them to it.
  const diff = await git(
    [
      "diff",
      "--name-only",
      "--relative",
      options.includeDeleted ? "--diff-filter=ACMRD" : "--diff-filter=ACMR",
      ref,
    ],
    options.cwd,
  );

  if (diff.code !== 0) {
    return {
      problem: gitProblem(
        `git diff against ${ref} failed: ${diff.stderr.trim() || `exit ${diff.code}`}`,
      ),
    };
  }

  const untracked = await git(["ls-files", "--others", "--exclude-standard"], options.cwd);

  if (untracked.code !== 0) {
    return {
      problem: gitProblem(
        `git ls-files failed: ${untracked.stderr.trim() || `exit ${untracked.code}`}`,
      ),
    };
  }

  const files = [...new Set([...lines(diff.stdout), ...lines(untracked.stdout)])]
    .map((file) => file.split(path.sep).join("/"))
    .filter(
      (file) =>
        SOURCE_FILE.test(file) &&
        (options.includeDeleted || existsSync(path.join(options.cwd, file))),
    )
    .sort();

  return { files };
}
