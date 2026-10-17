import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

/**
 * Which project files a generation can see and change, and how they are
 * copied, hashed and compared.
 *
 * THE SCOPE: the files at the project root plus the `src/` tree. That is where
 * every generator writes (`src/app/**`, `src/config/**`, `package.json`,
 * `warlock.config.ts`, `tsconfig.json`). `.env` files are never copied, hashed
 * or diffed: they hold secrets, and a diff is text an agent will read.
 */

/** Directory names never entered anywhere. */
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

/** Root directories outside the scope that a sandbox still never copies (listed for the walk of a sandbox). */
const SKIPPED_ROOT_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".warlock",
  "dist",
  "storage",
  "public",
  "coverage",
]);

/** Whether a file name is an env file (`.env`, `.env.local`, `.env.production`…). */
export function isEnvFile(name: string): boolean {
  return name === ".env" || name.startsWith(".env.");
}

/** A file's content hash, keyed by project-relative POSIX path. */
export type FileSnapshot = Map<string, string>;

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

function hashFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function walk(
  root: string,
  directory: string,
  visit: (absolute: string, relative: string) => void,
): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;

    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(root, absolute, visit);
      continue;
    }

    if (entry.isFile() && !isEnvFile(entry.name)) {
      visit(absolute, toPosix(path.relative(root, absolute)));
    }
  }
}

/**
 * Visit every file in the generation scope of `root`: root-level files and the
 * `src/` tree, skipping env files, symlinks, `node_modules` and `.git`.
 */
export function forEachScopedFile(
  root: string,
  visit: (absolute: string, relative: string) => void,
): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && !isEnvFile(entry.name)) {
      visit(path.join(root, entry.name), entry.name);
    }
  }

  const source = path.join(root, "src");

  if (existsSync(source)) walk(root, source, visit);
}

/**
 * Visit every file under `root` except env files, symlinks and the
 * {@link SKIPPED_ROOT_DIRECTORIES} — how a sandbox is read after a generator
 * ran, so a file written outside `src/` is still seen.
 */
export function forEachSandboxFile(
  root: string,
  visit: (absolute: string, relative: string) => void,
): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;

    const absolute = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_ROOT_DIRECTORIES.has(entry.name)) walk(root, absolute, visit);
    } else if (entry.isFile() && !isEnvFile(entry.name)) {
      visit(absolute, entry.name);
    }
  }
}

/** Hash every file the walker visits. */
export function snapshotFiles(
  root: string,
  walker: (root: string, visit: (absolute: string, relative: string) => void) => void,
): FileSnapshot {
  const snapshot: FileSnapshot = new Map();

  walker(root, (absolute, relative) => {
    snapshot.set(relative, hashFile(absolute));
  });

  return snapshot;
}

/**
 * Copy the generation scope of `projectRoot` into `sandboxRoot` and link the
 * project's `node_modules` into it, so `warlock.config.ts` and every package
 * resolve exactly as they do in the project. Nothing is copied from
 * `node_modules`; the link is removed with the sandbox, never followed.
 */
export function copyProjectScope(projectRoot: string, sandboxRoot: string): void {
  forEachScopedFile(projectRoot, (absolute, relative) => {
    const target = path.join(sandboxRoot, relative);

    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(absolute, target);
  });

  const modules = path.join(projectRoot, "node_modules");

  if (existsSync(modules)) {
    // "junction" is ignored off Windows and makes the link work there without admin rights.
    symlinkSync(modules, path.join(sandboxRoot, "node_modules"), "junction");
  }
}

/** One file that differs between two snapshots. */
export type SnapshotChange = { path: string; status: "created" | "modified" | "deleted" };

/** The files created, modified or deleted between two snapshots, sorted by path. */
export function compareSnapshots(before: FileSnapshot, after: FileSnapshot): SnapshotChange[] {
  const changes: SnapshotChange[] = [];

  for (const [file, hash] of after) {
    const previous = before.get(file);

    if (previous === undefined) changes.push({ path: file, status: "created" });
    else if (previous !== hash) changes.push({ path: file, status: "modified" });
  }

  for (const file of before.keys()) {
    if (!after.has(file)) changes.push({ path: file, status: "deleted" });
  }

  return changes.sort((first, second) => first.path.localeCompare(second.path));
}

/** Whether bytes look binary: a NUL in the first 8000 bytes, as git decides. */
export function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}
