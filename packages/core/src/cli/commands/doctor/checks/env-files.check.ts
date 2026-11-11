import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { rootPath } from "../../../../utils/paths";
import type { DoctorCheck } from "../check.types";
import { warnOnError } from "./config-values";

/** `.env` and `.env.<anything>` at the project root. */
const ENV_FILE = /^\.env(\..+)?$/;

/** Env templates meant to be committed: `.env.example`, `.env.sample`, … */
const ENV_TEMPLATE = /\.(example|sample|template|dist)$/;

/** The project's env files that hold values (templates excluded), by name. */
function envFiles(root: string): string[] {
  let names: string[];

  try {
    names = readdirSync(root);
  } catch {
    return [];
  }

  return names
    .filter((name) => ENV_FILE.test(name) && !ENV_TEMPLATE.test(name))
    .filter((name) => {
      try {
        return statSync(path.join(root, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * The env files in `root` that git would commit: not ignored, or already
 * tracked (git reports a tracked file as not ignored). `undefined` when there
 * are no env files, or when `root` is not inside a git work tree or git is not
 * available, since nothing is committed then.
 *
 * Asks git itself (`git check-ignore`), so every rule that applies counts:
 * the project's `.gitignore`, a parent one in a monorepo, and the global
 * excludes file.
 */
export function findCommittableEnvFiles(
  root: string,
): { files: string[]; committable: string[] } | undefined {
  const files = envFiles(root);

  if (files.length === 0) return undefined;

  // `--stdin -z`: the names go in and come back NUL-separated and unquoted, so
  // a name with characters git would quote still matches the name asked about.
  const result = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: root,
    input: `${files.join("\0")}\0`,
    encoding: "utf8",
    timeout: 10_000,
  });

  // 0: some paths ignored, 1: none ignored; anything else is "not a work tree" or no git.
  if (result.error || (result.status !== 0 && result.status !== 1)) return undefined;

  const ignored = new Set(
    String(result.stdout ?? "")
      .split("\0")
      .filter(Boolean),
  );

  return { files, committable: files.filter((file) => !ignored.has(file)) };
}

/**
 * Warns when env files at the project root are not ignored by git.
 *
 * Env files hold the app's secrets (database, mail, storage, JWT). Apps
 * generated before `.env.*` was added to the starter `.gitignore` ignore only
 * `.env`, so a `.env.production` or `.env.shared` created later, or the
 * secrets `warlock jwt.generate` writes there, are committed with the next
 * `git add`.
 *
 * NEEDS NO BOOTED APP — it lists the project root and asks git. Silent when
 * there are no env files besides templates (`.env.example`), or the project is
 * not in a git work tree.
 */
export const envFilesCheck: DoctorCheck = warnOnError({
  name: "env-files",
  run: () => {
    const found = findCommittableEnvFiles(rootPath());

    if (!found) return undefined;

    if (found.committable.length === 0) {
      return {
        name: "env-files",
        status: "ok",
        detail: `env files are ignored by git (${found.files.join(", ")})`,
      };
    }

    return {
      name: "env-files",
      status: "warn",
      detail:
        `${found.committable.join(", ")} ${found.committable.length === 1 ? "is" : "are"} not ` +
        "ignored by git — env files hold the app's secrets and would be committed. Add `.env` " +
        "and `.env.*` (then `!.env.example`) to .gitignore, and run `git rm --cached <file>` " +
        "for any env file already committed.",
    };
  },
});
