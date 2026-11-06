import path from "node:path";
import type { WorkspaceBackend, WorkspaceBackendDirEntry } from "../contracts";
import { globToRegExp, isInside, matchesAnyGlob } from "../policy/jail";

/** Directories `glob` and `grep` never descend into unless `search.skipDirs` says otherwise. */
export const DEFAULT_SEARCH_SKIP_DIRS: readonly string[] = [".git", "node_modules"];
/** Default most files one `glob` or `grep` walk looks at. */
export const DEFAULT_SEARCH_MAX_FILES = 50_000;
/** Default number of directories read at once during a walk. */
export const DEFAULT_SEARCH_CONCURRENCY = 16;

/** One parsed `.gitignore` line. */
interface IgnoreRule {
  /** Workspace-relative directory the `.gitignore` sits in ("" for the root). */
  base: string;
  negate: boolean;
  dirOnly: boolean;
  /** Matches the entry's name only (the pattern had no slash). */
  nameOnly: boolean;
  /** Pattern began with `**\/`: it may match at any depth under `base`. */
  anywhere: boolean;
  regex: RegExp;
}

/** What a walk looks at and how it is bounded. */
export interface WalkOptions {
  backend: WorkspaceBackend;
  /** Absolute jail root; every reported path is relative to it. */
  jailRoot: string;
  /** Absolute directory the walk starts in (inside the jail root). */
  startDir: string;
  /** `denyPaths` globs, checked before a directory is read. */
  denyPaths: readonly string[];
  skipDirs: readonly string[];
  gitignore: boolean;
  maxFiles: number;
  concurrency: number;
  signal?: AbortSignal;
}

/** Files found by a walk (absolute paths) and whether `maxFiles` cut it short. */
export interface WalkResult {
  files: string[];
  truncated: boolean;
}

/**
 * The directory a glob can be anchored at: its leading segments that hold no
 * wildcard, never counting the last segment (it may be a file). `""` is the root.
 */
export function staticGlobPrefix(pattern: string): string {
  const segments = pattern.split("/");
  const kept: string[] = [];

  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index] ?? "";

    if (segment === "" || segment === "." || segment === ".." || /[*?[\]{}\\]/.test(segment)) {
      break;
    }

    kept.push(segment);
  }

  return kept.join("/");
}

/** Parse the lines of a `.gitignore` located at workspace-relative `base`. */
function parseGitignore(content: string, base: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];

  for (const raw of content.split(/\r?\n/)) {
    let line = raw.trimEnd();

    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const negate = line.startsWith("!");

    if (negate) {
      line = line.slice(1);
    }

    const dirOnly = line.endsWith("/");

    if (dirOnly) {
      line = line.slice(0, -1);
    }

    const anywhere = line.startsWith("**/");

    if (anywhere) {
      line = line.slice(3);
    }

    if (line.startsWith("/")) {
      line = line.slice(1);
    }

    if (line === "") {
      continue;
    }

    rules.push({
      base,
      negate,
      dirOnly,
      anywhere,
      nameOnly: !anywhere && !line.includes("/") && !raw.trimStart().startsWith("/"),
      regex: globToRegExp(line),
    });
  }

  return rules;
}

/** Whether the ordered rules (last match wins) ignore the entry at `rel`. */
function isIgnored(rel: string, name: string, isDir: boolean, rules: readonly IgnoreRule[]): boolean {
  let ignored = false;

  for (const rule of rules) {
    if (rule.dirOnly && !isDir) {
      continue;
    }

    const local = rule.base === "" ? rel : rel.slice(rule.base.length + 1);
    let hit: boolean;

    if (rule.nameOnly) {
      hit = rule.regex.test(name);
    } else if (rule.anywhere) {
      const parts = local.split("/");

      hit = parts.some((_, index) => rule.regex.test(parts.slice(index).join("/")));
    } else {
      hit = rule.regex.test(local);
    }

    if (hit) {
      ignored = !rule.negate;
    }
  }

  return ignored;
}

/** Whether a directory name or relative path is one of the `skipDirs` globs. */
function isSkipped(name: string, rel: string, skipDirs: readonly string[]): boolean {
  return skipDirs.some((glob) =>
    glob.includes("/") ? matchesAnyGlob(rel, [glob]) : globToRegExp(glob).test(name),
  );
}

/**
 * List a directory with entry types: the backend's own typed listing when it has
 * one, else its plain listing plus `stat`, else (no `stat`) a second listing per
 * entry to tell directories from files.
 */
export async function listTyped(
  backend: WorkspaceBackend,
  absDir: string,
): Promise<WorkspaceBackendDirEntry[]> {
  if (backend.listTyped !== undefined) {
    return backend.listTyped(absDir);
  }

  const entries = await backend.list(absDir);

  return Promise.all(
    entries.map(async (entry): Promise<WorkspaceBackendDirEntry> => {
      if (backend.stat !== undefined) {
        try {
          return { path: entry, type: (await backend.stat(entry)).type };
        } catch {
          return { path: entry, type: "other" };
        }
      }

      try {
        const children = await backend.list(entry);

        if (children.length === 0) {
          // An empty listing may be a file on a backend that lists files as empty.
          try {
            await backend.readFile(entry);

            return { path: entry, type: "file" };
          } catch {
            return { path: entry, type: "directory" };
          }
        }

        return { path: entry, type: "directory" };
      } catch {
        return { path: entry, type: "file" };
      }
    }),
  );
}

/** Read `.gitignore` at `absDir`, or nothing when there is none. */
async function readGitignore(
  backend: WorkspaceBackend,
  absDir: string,
  base: string,
): Promise<IgnoreRule[]> {
  try {
    return parseGitignore(await backend.readFile(path.join(absDir, ".gitignore")), base);
  } catch {
    return [];
  }
}

/** A queued directory: where it is and the `.gitignore` rules in force above it. */
interface PendingDir {
  abs: string;
  rel: string;
  rules: IgnoreRule[];
}

/**
 * Walk the files under `startDir` breadth first. Denied, skipped and
 * gitignored directories are dropped before they are listed, so a tree such as
 * `node_modules` is never read. Directories are read `concurrency` at a time,
 * the signal is checked between batches, and the walk stops at `maxFiles`.
 * Symlinks are never followed; a symlink to a file is reported only when its
 * target is inside the jail root.
 */
export async function walkFiles(options: WalkOptions): Promise<WalkResult> {
  const { backend, jailRoot, startDir, denyPaths, skipDirs, signal } = options;
  const files: string[] = [];
  let truncated = false;

  const isDenied = (rel: string): boolean => denyPaths.length > 0 && matchesAnyGlob(rel, denyPaths);
  const isDeniedDir = (rel: string): boolean =>
    isDenied(rel) ||
    denyPaths.some((glob) => glob.endsWith("/**") && globToRegExp(glob.slice(0, -3)).test(rel));

  const startRel = path.relative(jailRoot, startDir).split(path.sep).join("/");
  let inherited: IgnoreRule[] = [];

  if (options.gitignore) {
    // Rules from the folders between the jail root and the start folder.
    const segments = startRel === "" ? [] : startRel.split("/");

    for (let depth = 0; depth < segments.length; depth++) {
      const base = segments.slice(0, depth).join("/");
      const abs = base === "" ? jailRoot : path.join(jailRoot, ...segments.slice(0, depth));

      inherited = inherited.concat(await readGitignore(backend, abs, base));
    }
  }

  let level: PendingDir[] = [{ abs: startDir, rel: startRel, rules: inherited }];

  const readDir = async (dir: PendingDir, next: PendingDir[]): Promise<void> => {
    let entries: WorkspaceBackendDirEntry[];

    try {
      entries = await listTyped(backend, dir.abs);
    } catch {
      // A start folder that does not exist matches nothing; a folder that
      // vanished mid-walk is skipped.
      return;
    }

    let rules = dir.rules;

    if (
      options.gitignore &&
      entries.some((entry) => path.basename(entry.path) === ".gitignore" && entry.type !== "directory")
    ) {
      rules = rules.concat(await readGitignore(backend, dir.abs, dir.rel));
    }

    for (const entry of entries) {
      if (files.length >= options.maxFiles) {
        truncated = true;

        return;
      }

      const name = path.basename(entry.path);
      const rel = dir.rel === "" ? name : `${dir.rel}/${name}`;
      let type = entry.type;
      let abs = entry.path;

      if (type === "symlink") {
        // Reported as a file only when it points at a file inside the jail.
        try {
          const target = await backend.realpath(entry.path);

          if (!isInside(target, jailRoot) || backend.stat === undefined) {
            continue;
          }

          if ((await backend.stat(target)).type !== "file") {
            continue;
          }

          type = "file";
          abs = entry.path;
        } catch {
          continue;
        }
      }

      if (type === "directory") {
        if (isDeniedDir(rel) || isSkipped(name, rel, skipDirs)) {
          continue;
        }

        if (options.gitignore && isIgnored(rel, name, true, rules)) {
          continue;
        }

        next.push({ abs, rel, rules });

        continue;
      }

      if (type !== "file" || isDenied(rel)) {
        continue;
      }

      if (options.gitignore && isIgnored(rel, name, false, rules)) {
        continue;
      }

      files.push(abs);
    }
  };

  while (level.length > 0 && !truncated) {
    const next: PendingDir[] = [];

    for (let index = 0; index < level.length && !truncated; index += options.concurrency) {
      signal?.throwIfAborted();

      await Promise.all(level.slice(index, index + options.concurrency).map((dir) => readDir(dir, next)));
    }

    signal?.throwIfAborted();
    level = next;
  }


  return { files, truncated };
}
